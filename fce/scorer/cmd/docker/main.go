// Package main is the Confidential Space entry point: it runs the Flare tee-node
// and the Plime scorer extension in one process.
//
// Docker sets PROXY_URL as an env var which tee-node reads directly via
// settings.init(), so nothing here needs the e2e harness.
package main

import (
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
	teeServer "github.com/flare-foundation/tee-node/pkg/server"

	"github.com/eienel/plime/fce/scorer/internal/config"
	extserver "github.com/eienel/plime/fce/scorer/pkg/server"
)

func main() {
	configPort := intEnv("CONFIG_PORT", 5501)

	// config.SignPort and config.ExtensionPort come from SIGN_PORT and
	// EXTENSION_PORT via config.init().
	signPort := config.SignPort
	extensionPort := config.ExtensionPort

	// Start tee-node in extension mode.
	go teeServer.StartServerExtension(configPort, signPort, extensionPort)

	// Start the scorer — fail fast if port binding fails.
	extErrCh := extserver.StartExtension(extensionPort, signPort)

	time.Sleep(100 * time.Millisecond)
	select {
	case err := <-extErrCh:
		logger.Fatalf("scorer failed to start: %v", err)
	default:
	}

	logger.Infof("plime scorer TEE running (config=%d, sign=%d, ext=%d)", configPort, signPort, extensionPort)

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	select {
	case <-sigChan:
		logger.Info("shutting down")
	case err := <-extErrCh:
		logger.Fatalf("scorer error: %v", err)
	}
}

func intEnv(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
