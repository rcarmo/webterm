package webterm

import "unicode"

const (
	coverageSpace      = 0
	coveragePunctLight = 32
	coveragePunct      = 64
	coverageLower      = 96
	coverageUpper      = 112
	coverageDigit      = 104
	coverageDefault    = 96
)

var firaCodeCoverage = map[rune]uint8{}

func init() {
	firaCodeCoverage[' '] = coverageSpace
	for _, r := range []rune(".,:;'\"") {
		firaCodeCoverage[r] = coveragePunctLight
	}
	for _, r := range []rune("`") {
		firaCodeCoverage[r] = coveragePunctLight
	}
	for _, r := range []rune("+-*/=<>()[]{}") {
		firaCodeCoverage[r] = coveragePunct
	}
	for _, r := range []rune("|!#@$%^&?_") {
		firaCodeCoverage[r] = coveragePunct
	}

	// Box drawing block — approximate light line density.
	for r := rune(0x2500); r <= 0x257F; r++ {
		firaCodeCoverage[r] = 72
	}

	// Block elements and shading.
	firaCodeCoverage['░'] = 64
	firaCodeCoverage['▒'] = 128
	firaCodeCoverage['▓'] = 192
	firaCodeCoverage['█'] = 255
	firaCodeCoverage['▀'] = 128
	firaCodeCoverage['▄'] = 128
	firaCodeCoverage['▌'] = 128
	firaCodeCoverage['▐'] = 128

	verticalBlocks := []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}
	for i, r := range verticalBlocks {
		firaCodeCoverage[r] = uint8((i + 1) * 255 / len(verticalBlocks))
	}
	leftBlocks := []rune{'▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'}
	for i, r := range leftBlocks {
		firaCodeCoverage[r] = uint8((i + 1) * 255 / len(leftBlocks))
	}
}

func coverageForRune(r rune) uint8 {
	if value, ok := firaCodeCoverage[r]; ok {
		return value
	}
	if unicode.IsSpace(r) {
		return coverageSpace
	}
	switch {
	case r >= '0' && r <= '9':
		return coverageDigit
	case r >= 'A' && r <= 'Z':
		return coverageUpper
	case r >= 'a' && r <= 'z':
		return coverageLower
	}
	if unicode.IsPunct(r) || unicode.IsSymbol(r) {
		return coveragePunct
	}
	return coverageDefault
}
