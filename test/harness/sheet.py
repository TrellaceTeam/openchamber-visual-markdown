# Tile screenshots into one contact sheet, so a review reads a few pictures instead of many.
# Usage: python sheet.py <out.png> <crop-height> <columns> <in1.png> [<in2.png> ...]
import sys
from PIL import Image, ImageDraw

out, crop_height, columns, *paths = sys.argv[1:]
crop_height = int(crop_height)
columns = int(columns)
tiles = []
for path in paths:
    image = Image.open(path).convert("RGB")
    tile = image.crop((0, 0, image.width, min(crop_height, image.height)))
    label = path.replace("\\", "/").split("/")[-1].replace(".png", "")
    draw = ImageDraw.Draw(tile)
    box = draw.textbbox((0, 0), label)
    draw.rectangle((tile.width - box[2] - 16, tile.height - 22, tile.width, tile.height), fill=(200, 60, 20))
    draw.text((tile.width - box[2] - 8, tile.height - 18), label, fill=(255, 255, 255))
    tiles.append(tile)

width = max(tile.width for tile in tiles)
height = max(tile.height for tile in tiles)
rows = (len(tiles) + columns - 1) // columns
gap = 6
sheet = Image.new("RGB", (columns * width + (columns - 1) * gap, rows * height + (rows - 1) * gap), (128, 128, 128))
for index, tile in enumerate(tiles):
    sheet.paste(tile, ((index % columns) * (width + gap), (index // columns) * (height + gap)))
sheet.save(out)
print(out, sheet.size)
