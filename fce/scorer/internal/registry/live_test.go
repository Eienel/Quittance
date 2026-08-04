package registry

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/eienel/quittance/fce/scorer/internal/score"
)

// Reads the real deployed InvoiceRegistry on Coston2. Skipped unless LIVE=1,
// so the default `go test ./...` stays hermetic.
func TestLiveCoston2Record(t *testing.T) {
	if os.Getenv("LIVE") != "1" {
		t.Skip("set LIVE=1 to read Coston2")
	}
	c, err := New("https://coston2-api.flare.network/ext/C/rpc")
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()

	reg := common.HexToAddress("0xC07009A556b88674BeA88BBd5794A7ef8402d00A")
	payer := common.HexToHash("0xfc2000c1cc37efcc6cad8046042a9c81f79fd59b8c80dba6a5517a7334fbf4fc")

	rec, err := c.Record(context.Background(), reg, payer)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("in-enclave view of history: %+v", rec)
	t.Logf("what leaves the enclave:    %+v", score.Compute(rec, uint64(time.Now().Unix())))

	if rec.SettledCount != 1 || rec.DelinquentCount != 1 {
		t.Fatalf("expected the live E2E record (1 settled, 1 delinquent), got %+v", rec)
	}
}
