// Package score turns an InvoiceRegistry payment record into a single
// creditworthiness number.
//
// This is the only thing allowed out of the enclave, so it is deliberately
// lossy: the inputs (how many invoices, for how much, when) are not
// recoverable from the output. A score is a summary, not an encoding.
package score

import "math"

// Record mirrors InvoiceRegistry.PayerRecord — the account's full attested history.
type Record struct {
	SettledCount     uint64
	DelinquentCount  uint64
	SettledDrops     uint64
	DelinquentDrops  uint64
	LastOutcomeUnix  uint64
}

// Result is what leaves the TEE. Band is included because it is what a lender
// actually acts on, and it degrades the number further rather than adding detail.
type Result struct {
	Score   int    `json:"score"`   // 300–850, or 0 when there is no history
	Band    string `json:"band"`    // none | poor | fair | good | excellent
	Basis   int    `json:"basis"`   // number of attested outcomes behind the score
	Version string `json:"version"` // scoring model version, so a score is reproducible
}

const (
	Min = 300
	Max = 850

	// A thin file should not read as a good one. Confidence ramps in over this
	// many outcomes, pulling sparse records toward the neutral baseline.
	confidenceOutcomes = 6.0
	baseline           = 500.0

	// An account with no outcome for this long has a stale record; the score
	// decays toward baseline rather than resting on old good behaviour.
	stalenessSeconds = 365 * 24 * 3600.0

	ModelVersion = "quittance-score-1"
)

// Compute scores a record as of `nowUnix`.
//
// Two ratios drive it, weighted toward value: a delinquency on a large invoice
// says more than one on a trivial invoice, but count still matters because a
// habit of missing small invoices is itself a signal.
func Compute(r Record, nowUnix uint64) Result {
	outcomes := r.SettledCount + r.DelinquentCount
	if outcomes == 0 {
		return Result{Score: 0, Band: "none", Basis: 0, Version: ModelVersion}
	}

	byCount := ratio(r.SettledCount, outcomes)
	byValue := byCount // fall back to count when every invoice was zero-valued
	if drops := r.SettledDrops + r.DelinquentDrops; drops > 0 {
		byValue = ratio(r.SettledDrops, drops)
	}
	quality := 0.4*byCount + 0.6*byValue

	// Confidence: a single settled invoice is not an excellent record.
	confidence := math.Min(1, float64(outcomes)/confidenceOutcomes)

	// Staleness: pull an old record back toward the baseline.
	if r.LastOutcomeUnix > 0 && nowUnix > r.LastOutcomeUnix {
		age := float64(nowUnix-r.LastOutcomeUnix) / stalenessSeconds
		confidence *= math.Max(0.25, 1-0.5*math.Min(age, 1))
	}

	raw := baseline + confidence*(quality*(Max-baseline)-(1-quality)*(baseline-Min))
	s := int(math.Round(clamp(raw, Min, Max)))

	return Result{Score: s, Band: band(s), Basis: int(outcomes), Version: ModelVersion}
}

func ratio(part, whole uint64) float64 {
	if whole == 0 {
		return 0
	}
	return float64(part) / float64(whole)
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

func band(s int) string {
	switch {
	case s >= 740:
		return "excellent"
	case s >= 670:
		return "good"
	case s >= 580:
		return "fair"
	default:
		return "poor"
	}
}
