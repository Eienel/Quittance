// Package server starts the scorer extension's HTTP server.
package server

import "github.com/eienel/quittance/fce/scorer/internal/extension"

// StartExtension creates and starts the scorer extension in a goroutine.
// Returns an error channel that receives any ListenAndServe failure.
func StartExtension(extensionPort, signPort int) <-chan error {
	e := extension.New(extensionPort, signPort)
	errCh := make(chan error, 1)
	go func() {
		if err := e.Server.ListenAndServe(); err != nil {
			errCh <- err
		}
	}()
	return errCh
}
