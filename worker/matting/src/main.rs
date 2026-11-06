//! Matting worker: loads an ONNX matting model once and answers requests on
//! stdin/stdout. The Go workbench owns all user-facing behavior; this process
//! only turns an upright RGB PNG into straight-alpha RGBA pixels so a native
//! runtime failure cannot take the UI down with it.
//!
//! Protocol (little endian):
//!   stdout starts with "SIM1\n".
//!   request  = u32 length + PNG bytes (length 0 exits)
//!   response = u32 length + status byte + body
//!      status 0: u32 width, u32 height, width*height*4 RGBA bytes
//!      status 1: UTF-8 error message
//! Logs go to stderr.

use std::env;
use std::io::{self, Read, Write};
use std::process::ExitCode;

use image::imageops::FilterType;
use image::{GrayImage, ImageBuffer, Luma};
use ort::session::Session;
use ort::value::{Value, ValueType};

const MAGIC: &[u8; 5] = b"SIM1\n";
const MAX_FRAME: usize = 512 * 1024 * 1024;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

struct Args {
    model: String,
    threads: usize,
}

fn parse_args() -> Result<Args, String> {
    let mut model = None;
    let mut threads = 0usize;
    let mut it = env::args().skip(1);
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--model" => model = it.next(),
            "--threads" => {
                threads = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .ok_or_else(|| "--threads needs a number".to_string())?;
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }
    let model = model.ok_or_else(|| "usage: matting-worker --model <file.onnx> [--threads N]".to_string())?;
    Ok(Args { model, threads })
}

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let environment = match ort::init().with_name("matting-worker").build() {
        Ok(environment) => environment,
        Err(err) => {
            eprintln!("onnxruntime init failed: {err}");
            return ExitCode::from(2);
        }
    };
    let mut session = match build_session(&environment, &args) {
        Ok(session) => session,
        Err(err) => {
            eprintln!("model load failed: {err}");
            return ExitCode::from(2);
        }
    };

    let stdin = io::stdin();
    let mut input = stdin.lock();
    let stdout = io::stdout();
    let mut output = stdout.lock();
    if output.write_all(MAGIC).and_then(|_| output.flush()).is_err() {
        return ExitCode::from(3);
    }

    loop {
        let mut len = [0u8; 4];
        match input.read_exact(&mut len) {
            Ok(()) => {}
            Err(err) if err.kind() == io::ErrorKind::UnexpectedEof => return ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("read frame header: {err}");
                return ExitCode::from(3);
            }
        }
        let len = u32::from_le_bytes(len) as usize;
        if len == 0 {
            return ExitCode::SUCCESS;
        }
        if len > MAX_FRAME {
            if write_error(&mut output, "image frame is too large").is_err() {
                return ExitCode::from(3);
            }
            continue;
        }
        let mut png = vec![0u8; len];
        if let Err(err) = input.read_exact(&mut png) {
            eprintln!("read frame: {err}");
            return ExitCode::from(3);
        }
        let result = run_request(&mut session, &png).and_then(|(w, h, rgba)| {
            write_pixels(&mut output, w, h, &rgba).map_err(|e| e.to_string())
        });
        if let Err(message) = result {
            if write_error(&mut output, &message).is_err() {
                return ExitCode::from(3);
            }
        }
    }
}

fn build_session(environment: &ort::environment::Environment, args: &Args) -> Result<Session, String> {
    let mut builder = Session::builder(environment).map_err(|e| e.to_string())?;
    if args.threads > 0 {
        builder = builder
            .with_intra_threads(args.threads)
            .map_err(|e| e.to_string())?;
    }
    builder
        .commit_from_file(&args.model)
        .map_err(|e| e.to_string())
}

fn run_request(session: &mut Session, png: &[u8]) -> Result<(u32, u32, Vec<u8>), String> {
    let image = image::load_from_memory(png)
        .map_err(|e| format!("decode request image: {e}"))?
        .to_rgb8();
    let (width, height) = (image.width(), image.height());
    let (mw, mh) = input_size(session)?;

    let model_input = image::imageops::resize(&image, mw, mh, FilterType::Lanczos3);
    let mut tensor = vec![0f32; 3 * (mw as usize) * (mh as usize)];
    let plane = (mw as usize) * (mh as usize);
    for (i, pixel) in model_input.pixels().enumerate() {
        for c in 0..3 {
            tensor[c * plane + i] = (pixel[c] as f32 / 255.0 - MEAN[c]) / STD[c];
        }
    }
    let max = tensor.iter().fold(f32::MIN, |m, v| m.max(*v)).max(1e-6);
    for v in tensor.iter_mut() {
        *v /= max;
    }

    let value = Value::from_array(([1usize, 3, mh as usize, mw as usize], tensor.into_boxed_slice()))
        .map_err(|e| e.to_string())?;
    let outputs = session
        .run(ort::inputs![value])
        .map_err(|e| format!("inference failed: {e}"))?;
    let (_, scores) = outputs[0]
        .try_extract_tensor::<f32>()
        .map_err(|e| e.to_string())?;

    let mask = scores_to_mask(scores, mw, mh)?;
    let mask = image::imageops::resize(&mask, width, height, FilterType::Lanczos3);

    let mut rgba = Vec::with_capacity((width as usize) * (height as usize) * 4);
    for (pixel, alpha) in image.pixels().zip(mask.pixels()) {
        rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], alpha[0]]);
    }
    Ok((width, height, rgba))
}

fn scores_to_mask(scores: &[f32], width: u32, height: u32) -> Result<GrayImage, String> {
    let plane = (width as usize) * (height as usize);
    if scores.len() < plane {
        return Err("model returned an unexpected mask size".to_string());
    }
    let mut lo = f32::MAX;
    let mut hi = f32::MIN;
    for v in &scores[..plane] {
        lo = lo.min(*v);
        hi = hi.max(*v);
    }
    let span = (hi - lo).max(1e-6);
    let mut mask: GrayImage = ImageBuffer::new(width, height);
    for (i, pixel) in mask.pixels_mut().enumerate() {
        let normalized = (scores[i] - lo) / span;
        *pixel = Luma([(normalized.clamp(0.0, 1.0) * 255.0).round() as u8]);
    }
    Ok(mask)
}

/// input_size reads the model's NCHW spatial size. Models used by the
/// workbench are square; non-square input falls back to the smaller side.
fn input_size(session: &Session) -> Result<(u32, u32), String> {
    let input = session
        .inputs()
        .first()
        .ok_or_else(|| "model has no inputs".to_string())?;
    let ValueType::Tensor { shape, .. } = input.dtype() else {
        return Err("model input is not a tensor".to_string());
    };
    let n = shape.len();
    if n < 2 {
        return Err(format!("unexpected input shape {shape:?}"));
    }
    let h = shape[n - 2];
    let w = shape[n - 1];
    if h <= 0 || w <= 0 {
        return Err(format!("model input is not fixed: {shape:?}"));
    }
    Ok((w as u32, h as u32))
}

fn write_pixels(out: &mut impl Write, width: u32, height: u32, rgba: &[u8]) -> io::Result<()> {
    let body = 1 + 8 + rgba.len();
    out.write_all(&(body as u32).to_le_bytes())?;
    out.write_all(&[0u8])?;
    out.write_all(&width.to_le_bytes())?;
    out.write_all(&height.to_le_bytes())?;
    out.write_all(rgba)?;
    out.flush()
}

fn write_error(out: &mut impl Write, message: &str) -> io::Result<()> {
    let bytes = message.as_bytes();
    out.write_all(&((1 + bytes.len()) as u32).to_le_bytes())?;
    out.write_all(&[1u8])?;
    out.write_all(bytes)?;
    out.flush()
}
