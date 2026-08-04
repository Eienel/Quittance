// Package config holds the scorer extension's operation types and runtime defaults.
package config

import (
	"os"
	"strconv"
	"time"
)

const (
	Version = "0.1.0"

	// Must match the constants in ScoreInstructionSender.sol.
	OPTypeScoring       = "SCORING"
	OPCommandScorePayer = "SCORE_PAYER"

	TimeoutShutdown = 5 * time.Second
)

var (
	ExtensionPort = 8080
	SignPort      = 9090

	// The chain the enclave reads InvoiceRegistry from.
	FlareRPC = "https://coston2-api.flare.network/ext/C/rpc"
)

func init() {
	if v, err := strconv.Atoi(os.Getenv("EXTENSION_PORT")); err == nil && v != 0 {
		ExtensionPort = v
	}
	if v, err := strconv.Atoi(os.Getenv("SIGN_PORT")); err == nil && v != 0 {
		SignPort = v
	}
	if v := os.Getenv("FLARE_RPC"); v != "" {
		FlareRPC = v
	}
}
