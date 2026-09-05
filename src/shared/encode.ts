// 统一编码参数：各引擎共用一套 sharp 输出配置
import type sharp from 'sharp';
import { normalizeExt } from './formats';

// 按归一化扩展名应用编码，未知扩展名原样返回
export function applyEncoding(pipeline: sharp.Sharp, ext: string): sharp.Sharp {
    const normalized = normalizeExt(ext);
    if (normalized === '.webp') {
        return pipeline.webp({ quality: 80, effort: 6 });
    }
    if (normalized === '.png') {
        return pipeline.png({ quality: 80, effort: 8 });
    }
    if (normalized === '.jpg' || normalized === '.jpeg') {
        // '.jpeg' 分支为显式兼容保留：normalizeExt 已将其归一为 .jpg，
        // 此处兜住未来绕过归一直接传入的裸值（单测锁定）
        return pipeline.jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' });
    }
    return pipeline;
}
