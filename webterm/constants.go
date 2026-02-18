package webterm

import (
	"os"
	"runtime"
	"strings"
)

const (
	DefaultHost           = "0.0.0.0"
	DefaultPort           = 8080
	DefaultTheme          = "xterm"
	DefaultFontSize       = 16
	DefaultTerminalWidth  = 132
	DefaultTerminalHeight = 45

	ScreenshotForceRedrawEnv = "WEBTERM_SCREENSHOT_FORCE_REDRAW"
	ScreenshotModeEnv       = "WEBTERM_SCREENSHOT_MODE"
	DockerUsernameEnv        = "WEBTERM_DOCKER_USERNAME"
	DockerAutoCommandEnv     = "WEBTERM_DOCKER_AUTO_COMMAND"
	DockerHostEnv            = "DOCKER_HOST"

	AutoCommandSentinel = "__docker_exec__"
)

var Version = "dev"

var Windows = runtime.GOOS == "windows"

func init() {
	if strings.TrimSpace(Version) != "" && Version != "dev" {
		return
	}
	for _, candidate := range []string{"VERSION", "../VERSION", "../../VERSION"} {
		data, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		if v := strings.TrimSpace(string(data)); v != "" {
			Version = v
			return
		}
	}
}

func EnvBool(name string) bool {
	v, ok := os.LookupEnv(name)
	if !ok {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
