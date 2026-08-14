// Package registry reads payment history out of an InvoiceRegistry on Flare.
//
// This read happens inside the enclave. The full history is fetched here,
// summarized by the score package, and then discarded - it exists only in
// enclave memory and is never written to the response, to disk, or to a log.
package registry

import (
	"context"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/eienel/plime/fce/scorer/internal/score"
)

// Only the one view the scorer needs - a narrow ABI is a narrow blast radius.
const recordABI = `[{
  "inputs":[{"internalType":"bytes32","name":"payerAddressHash","type":"bytes32"}],
  "name":"record",
  "outputs":[{"components":[
    {"internalType":"uint64","name":"settledCount","type":"uint64"},
    {"internalType":"uint64","name":"delinquentCount","type":"uint64"},
    {"internalType":"uint256","name":"settledDrops","type":"uint256"},
    {"internalType":"uint256","name":"delinquentDrops","type":"uint256"},
    {"internalType":"uint64","name":"lastOutcomeTimestamp","type":"uint64"}
  ],"internalType":"struct InvoiceRegistry.PayerRecord","name":"","type":"tuple"}],
  "stateMutability":"view","type":"function"}]`

// Client reads records from a Flare RPC endpoint.
type Client struct {
	eth *ethclient.Client
	abi abi.ABI
}

func New(rpcURL string) (*Client, error) {
	eth, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, err
	}
	parsed, err := abi.JSON(strings.NewReader(recordABI))
	if err != nil {
		return nil, err
	}
	return &Client{eth: eth, abi: parsed}, nil
}

func (c *Client) Close() {
	if c.eth != nil {
		c.eth.Close()
	}
}

type rawRecord struct {
	SettledCount         uint64
	DelinquentCount      uint64
	SettledDrops         *big.Int
	DelinquentDrops      *big.Int
	LastOutcomeTimestamp uint64
}

// Record fetches one account's attested outcome history.
func (c *Client) Record(ctx context.Context, invoiceRegistry common.Address, payerHash common.Hash) (score.Record, error) {
	input, err := c.abi.Pack("record", payerHash)
	if err != nil {
		return score.Record{}, err
	}

	out, err := c.eth.CallContract(ctx, ethereumCallMsg(invoiceRegistry, input), nil)
	if err != nil {
		return score.Record{}, err
	}

	// The single output is a tuple, so unpack yields one element holding the
	// whole struct - UnpackIntoInterface would try to flatten it into fields.
	values, err := c.abi.Unpack("record", out)
	if err != nil {
		return score.Record{}, err
	}
	if len(values) != 1 {
		return score.Record{}, fmt.Errorf("record: expected 1 output, got %d", len(values))
	}
	raw := *abi.ConvertType(values[0], new(rawRecord)).(*rawRecord)

	return score.Record{
		SettledCount:    raw.SettledCount,
		DelinquentCount: raw.DelinquentCount,
		// Drop totals are bounded by XRP's 100e9 supply, so they fit a uint64
		// comfortably; saturate rather than wrap if a test registry says otherwise.
		SettledDrops:    toUint64(raw.SettledDrops),
		DelinquentDrops: toUint64(raw.DelinquentDrops),
		LastOutcomeUnix: raw.LastOutcomeTimestamp,
	}, nil
}

func toUint64(v *big.Int) uint64 {
	if v == nil || v.Sign() < 0 {
		return 0
	}
	if !v.IsUint64() {
		return ^uint64(0)
	}
	return v.Uint64()
}
