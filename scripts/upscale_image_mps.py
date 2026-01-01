import argparse
from pathlib import Path

import numpy as np
from PIL import Image
import torch
from spandrel import ModelLoader


def _to_tensor(img: Image.Image, device: torch.device) -> torch.Tensor:
    arr = np.asarray(img, dtype=np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    if arr.shape[2] == 4:
        arr = arr[:, :, :3]
    t = torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0)
    return t.to(device=device, dtype=torch.float32)


def _to_image(out: torch.Tensor) -> Image.Image:
    out = out.detach().clamp(0, 1).squeeze(0).permute(1, 2, 0).cpu().numpy()
    out = (out * 255.0).round().astype(np.uint8)
    return Image.fromarray(out, mode="RGB")


def upscale_image(
    *,
    input_path: Path,
    output_path: Path,
    weights_path: Path,
    device_str: str,
    tile_size: int,
    tile_pad: int,
) -> int:
    if not input_path.exists():
        raise FileNotFoundError(f"Input not found: {input_path}")
    if not weights_path.exists():
        raise FileNotFoundError(f"Weights not found: {weights_path}")

    device = torch.device(device_str)

    loader = ModelLoader(device=device)
    desc = loader.load_from_file(weights_path)
    model = desc.model
    scale = int(getattr(desc, "scale", 4) or 4)

    model.eval()

    img = Image.open(input_path).convert("RGB")
    w, h = img.size

    if tile_size and tile_size > 0:
        out_w, out_h = w * scale, h * scale
        out_img = np.zeros((out_h, out_w, 3), dtype=np.uint8)

        with torch.no_grad():
            for y0 in range(0, h, tile_size):
                for x0 in range(0, w, tile_size):
                    y1 = min(y0 + tile_size, h)
                    x1 = min(x0 + tile_size, w)

                    in_y0 = max(y0 - tile_pad, 0)
                    in_x0 = max(x0 - tile_pad, 0)
                    in_y1 = min(y1 + tile_pad, h)
                    in_x1 = min(x1 + tile_pad, w)

                    tile = img.crop((in_x0, in_y0, in_x1, in_y1))
                    tile_t = _to_tensor(tile, device)

                    out_t = model(tile_t)

                    crop_y0 = (y0 - in_y0) * scale
                    crop_x0 = (x0 - in_x0) * scale
                    crop_y1 = crop_y0 + (y1 - y0) * scale
                    crop_x1 = crop_x0 + (x1 - x0) * scale

                    out_tile = (
                        out_t.detach()
                        .clamp(0, 1)
                        .squeeze(0)
                        .permute(1, 2, 0)
                        .cpu()
                        .numpy()
                    )
                    out_tile = (out_tile * 255.0).round().astype(np.uint8)
                    out_tile = out_tile[crop_y0:crop_y1, crop_x0:crop_x1]

                    out_img[y0 * scale : y1 * scale, x0 * scale : x1 * scale] = out_tile

        Image.fromarray(out_img, mode="RGB").save(output_path)
        return scale

    with torch.no_grad():
        t = _to_tensor(img, device)
        out = model(t)

    _to_image(out).save(output_path)
    return scale


def main() -> int:
    parser = argparse.ArgumentParser(description="Upscale an image using MPS + spandrel RealESRGAN weights")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--tile-size", type=int, default=512)
    parser.add_argument("--tile-pad", type=int, default=10)

    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    weights_path = Path(args.weights)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    scale = upscale_image(
        input_path=input_path,
        output_path=output_path,
        weights_path=weights_path,
        device_str=args.device,
        tile_size=args.tile_size,
        tile_pad=args.tile_pad,
    )

    print(
        {
            "success": True,
            "input": str(input_path),
            "output": str(output_path),
            "scale": scale,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
