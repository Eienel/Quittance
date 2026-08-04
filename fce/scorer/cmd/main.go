// Command scorer runs the Quittance Confidential scoring extension.
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/eienel/quittance/fce/scorer/internal/config"
	"github.com/eienel/quittance/fce/scorer/internal/extension"

	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

func main() {
	e := extension.New(config.ExtensionPort, config.SignPort)

	go func() {
		logger.Infof("quittance scorer listening on :%d (registry chain %s)", config.ExtensionPort, config.FlareRPC)
		if err := e.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Errorf("extension server: %v", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), config.TimeoutShutdown)
	defer cancel()
	if err := e.Server.Shutdown(ctx); err != nil {
		logger.Errorf("shutdown: %v", err)
	}
}
