// Package types describes the scorer extension's wire surface.
package types

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// ScorePayerRequest is the ABI-decoded payload sent by ScoreInstructionSender.
type ScorePayerRequest struct {
	InvoiceRegistry  common.Address `json:"invoiceRegistry"`
	PayerAddressHash common.Hash    `json:"payerAddressHash"`
}

// ScorePayerResponse is everything the enclave returns.
//
// Note what is absent: no counts, no amounts, no invoice ids, no timestamps
// beyond the score's own basis. A caller that sees this response learns the
// account's creditworthiness and cannot reconstruct the history behind it.
type ScorePayerResponse struct {
	Score   int    `json:"score"`
	Band    string `json:"band"`
	Basis   int    `json:"basis"`
	Version string `json:"version"`
}

// ScorePayerMessageArg mirrors ScorePayerMessage in ScoreInstructionSender.sol.
var ScorePayerMessageArg abi.Argument

func init() {
	tupleTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "invoiceRegistry", Type: "address"},
		{Name: "payerAddressHash", Type: "bytes32"},
	})
	ScorePayerMessageArg = abi.Argument{Type: tupleTy}
}

// State is the extension's observable state, returned by GET /state.
//
// Aggregate counters only - per-account results would leak exactly what the
// enclave exists to protect.
type State struct {
	ScoresComputed int    `json:"scoresComputed"`
	ModelVersion   string `json:"modelVersion"`
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
