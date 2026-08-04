// Package extension implements the Quittance Confidential scorer as a Flare
// Compute Extension.
//
// The whole point of running this in a TEE is the asymmetry between what goes
// in and what comes out: the instruction names an account, the enclave reads
// that account's entire attested payment history from the InvoiceRegistry, and
// only a score comes back. Nobody — not the caller, not the machine operator,
// not the Foundation — sees the history, and the enclave's attestation is what
// makes that a checkable claim rather than a promise.
package extension

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/eienel/quittance/fce/scorer/internal/config"
	"github.com/eienel/quittance/fce/scorer/internal/registry"
	"github.com/eienel/quittance/fce/scorer/internal/score"
	"github.com/eienel/quittance/fce/scorer/pkg/types"

	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

const readTimeout = 15 * time.Second

type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	chain *registry.Client

	// Aggregate only. Deliberately not per-account: a counter keyed by account
	// would turn GET /state into the leak this design exists to prevent.
	scoresComputed int
}

// --- DO NOT MODIFY: New(), actionHandler() are boilerplate.
func New(extensionPort, signPort int) *Extension {
	e := &Extension{}

	chain, err := registry.New(config.FlareRPC)
	if err != nil {
		// Fail loudly at construction rather than answering every instruction
		// with a scoring error nobody can diagnose.
		panic(fmt.Sprintf("connecting to Flare RPC %s: %v", config.FlareRPC, err))
	}
	e.chain = chain

	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)

	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			ScoresComputed: e.scoresComputed,
			ModelVersion:   score.ModelVersion,
		},
	}
	e.mu.RUnlock()

	if err := json.NewEncoder(w).Encode(stateResponse); err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypeScoring):
		return e.processScoring(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeScoring).Hex(), config.OPTypeScoring,
		))
	}
}

func (e *Extension) processScoring(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandScorePayer):
		ar := e.processScorePayer(action, df)
		b, _ := json.Marshal(ar)
		return http.StatusOK, b

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op command: received %s, expected %s (%s)",
			df.OPCommand.Hex(),
			teeutils.ToHash(config.OPCommandScorePayer).Hex(), config.OPCommandScorePayer,
		))
	}
}

// processScorePayer is the confidential boundary: history in, score out.
func (e *Extension) processScorePayer(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var req types.ScorePayerRequest
	if err := structs.DecodeTo(types.ScorePayerMessageArg, df.OriginalMessage, &req); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding request: %w", err))
	}
	if (req.PayerAddressHash == [32]byte{}) {
		return buildResult(action, df, nil, 0, fmt.Errorf("payerAddressHash must not be zero"))
	}

	ctx, cancel := context.WithTimeout(context.Background(), readTimeout)
	defer cancel()

	// `rec` holds the account's full history. It stays in enclave memory, is
	// summarized on the next line, and is never logged or returned.
	rec, err := e.chain.Record(ctx, req.InvoiceRegistry, req.PayerAddressHash)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("reading registry record: %w", err))
	}

	result := score.Compute(rec, uint64(time.Now().Unix()))

	e.mu.Lock()
	e.scoresComputed++
	e.mu.Unlock()

	data, _ := json.Marshal(types.ScorePayerResponse{
		Score:   result.Score,
		Band:    result.Band,
		Basis:   result.Basis,
		Version: result.Version,
	})

	return buildResult(action, df, data, 1, nil)
}
