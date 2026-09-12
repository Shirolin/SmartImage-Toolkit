import sharp from 'sharp';

// EXIF 方向处理：sharp 的 metadata() 返回的是**未经旋转的原始像素尺寸**。
// orientation 5~8 表示显示时需要旋转 90/270 度，此时宽高在视觉上是互换的，
// 因此凡是用 metadata 宽高参与坐标计算（切割线、裁剪框、居中边距）的地方，
// 都必须换成这里返回的“摆正后”尺寸，否则坐标系会整体错位。
export async function orientedSize(filePath: string): Promise<{ width: number; height: number }> {
    const metadata = await sharp(filePath).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    // orientation 5/6/7/8 为旋转 90 度或 270 度：摆正后宽高互换
    const needsSwap =
        typeof metadata.orientation === 'number' && metadata.orientation >= 5 && metadata.orientation <= 8;
    return needsSwap ? { width: height, height: width } : { width, height };
}
