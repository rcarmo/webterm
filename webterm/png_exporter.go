package webterm

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strconv"
	"strings"

	"github.com/rcarmo/webterm/internal/terminalstate"
)

const (
	pngCharWidth  = 8
	pngCellHeight = 17
	pngPadding    = 10
)

func RenderTerminalPNG(
	buffer [][]terminalstate.Cell,
	width, height int,
	background, foreground string,
	palette map[string]string,
) ([]byte, error) {
	if background == "" {
		background = "#000000"
	}
	if foreground == "" {
		foreground = "#d3d7cf"
	}
	if palette == nil {
		palette = ansiColors
	}
	cellHeight := pngCellHeight
	imgWidth := width*pngCharWidth + pngPadding*2
	imgHeight := height*cellHeight + pngPadding*2
	if imgWidth <= 0 || imgHeight <= 0 {
		return nil, nil
	}

	bgFillColor := mustParseHexColor(background)
	img := image.NewRGBA(image.Rect(0, 0, imgWidth, imgHeight))
	draw.Draw(img, img.Bounds(), &image.Uniform{bgFillColor}, image.Point{}, draw.Src)

	// Cache parsed colors to avoid per-cell hex parsing overhead on large terminals.
	colorCache := map[string]color.RGBA{}
	parseColor := func(hex string) color.RGBA {
		if c, ok := colorCache[hex]; ok {
			return c
		}
		c := mustParseHexColor(hex)
		colorCache[hex] = c
		return c
	}

	for rowIdx := 0; rowIdx < len(buffer); rowIdx++ {
		row := buffer[rowIdx]
		rectY := pngPadding + rowIdx*cellHeight
		for col := 0; col < len(row); col++ {
			cell := row[col]
			charData := cell.Data

			// Fast-path skip for visually empty cells (default background, no reverse video).
			if (charData == "" || charData == " ") && !cell.Reverse &&
				(cell.BG == "" || strings.EqualFold(cell.BG, "default")) {
				continue
			}

			x := pngPadding + col*pngCharWidth
			fgHex := colorToHex(cell.FG, true, palette, foreground, background)
			bgHex := colorToHex(cell.BG, false, palette, foreground, background)
			if cell.Reverse {
				fgHex, bgHex = bgHex, fgHex
			}

			// If there's no glyph, only render background when it differs from the image background.
			if charData == "" || charData == " " {
				if bgHex == background {
					continue
				}
				draw.Draw(
					img,
					image.Rect(x, rectY, x+pngCharWidth, rectY+cellHeight),
					&image.Uniform{parseColor(bgHex)},
					image.Point{},
					draw.Src,
				)
				continue
			}

			bgColor := parseColor(bgHex)
			fgColor := parseColor(fgHex)
			coverage := coverageForRune(firstRune(charData))
			var cellColor color.RGBA
			switch coverage {
			case 0:
				cellColor = bgColor
			case 255:
				cellColor = fgColor
			default:
				cellColor = blendColors(fgColor, bgColor, coverage)
			}

			// Skip drawing default background cells (background already filled).
			if cellColor == bgFillColor {
				continue
			}

			draw.Draw(
				img,
				image.Rect(x, rectY, x+pngCharWidth, rectY+cellHeight),
				&image.Uniform{cellColor},
				image.Point{},
				draw.Src,
			)
		}
	}

	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func firstRune(value string) rune {
	for _, r := range value {
		return r
	}
	return ' '
}

func blendColors(fg, bg color.RGBA, coverage uint8) color.RGBA {
	inv := 255 - uint16(coverage)
	cov := uint16(coverage)
	r := (uint16(fg.R)*cov + uint16(bg.R)*inv + 127) / 255
	g := (uint16(fg.G)*cov + uint16(bg.G)*inv + 127) / 255
	b := (uint16(fg.B)*cov + uint16(bg.B)*inv + 127) / 255
	return color.RGBA{R: uint8(r), G: uint8(g), B: uint8(b), A: 255}
}

func mustParseHexColor(value string) color.RGBA {
	value = strings.TrimSpace(strings.TrimPrefix(value, "#"))
	if len(value) != 6 {
		return color.RGBA{A: 255}
	}
	r, err := strconv.ParseUint(value[0:2], 16, 8)
	if err != nil {
		return color.RGBA{A: 255}
	}
	g, err := strconv.ParseUint(value[2:4], 16, 8)
	if err != nil {
		return color.RGBA{A: 255}
	}
	b, err := strconv.ParseUint(value[4:6], 16, 8)
	if err != nil {
		return color.RGBA{A: 255}
	}
	return color.RGBA{R: uint8(r), G: uint8(g), B: uint8(b), A: 255}
}
