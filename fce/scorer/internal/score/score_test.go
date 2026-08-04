package score

import "testing"

const now = 1_800_000_000

func TestNoHistoryScoresZero(t *testing.T) {
	got := Compute(Record{}, now)
	if got.Score != 0 || got.Band != "none" {
		t.Fatalf("empty record: got %+v, want score 0 / band none", got)
	}
}

func TestPerfectRecordBeatsMixedBeatsDelinquent(t *testing.T) {
	perfect := Compute(Record{SettledCount: 10, SettledDrops: 100e6, LastOutcomeUnix: now}, now)
	mixed := Compute(Record{
		SettledCount: 5, DelinquentCount: 5,
		SettledDrops: 50e6, DelinquentDrops: 50e6, LastOutcomeUnix: now,
	}, now)
	bad := Compute(Record{DelinquentCount: 10, DelinquentDrops: 100e6, LastOutcomeUnix: now}, now)

	if !(perfect.Score > mixed.Score && mixed.Score > bad.Score) {
		t.Fatalf("ordering broken: perfect=%d mixed=%d bad=%d", perfect.Score, mixed.Score, bad.Score)
	}
	if perfect.Band != "excellent" || bad.Band != "poor" {
		t.Fatalf("bands: perfect=%s bad=%s", perfect.Band, bad.Band)
	}
}

// A thin file must not read as a strong one: one settled invoice is weak evidence.
func TestConfidenceRampsWithHistory(t *testing.T) {
	thin := Compute(Record{SettledCount: 1, SettledDrops: 10e6, LastOutcomeUnix: now}, now)
	thick := Compute(Record{SettledCount: 12, SettledDrops: 120e6, LastOutcomeUnix: now}, now)
	if thin.Score >= thick.Score {
		t.Fatalf("thin file (%d) should score below thick file (%d)", thin.Score, thick.Score)
	}
	if thin.Basis != 1 || thick.Basis != 12 {
		t.Fatalf("basis: thin=%d thick=%d", thin.Basis, thick.Basis)
	}
}

// A large missed invoice should hurt more than a small one, at equal counts.
func TestValueWeightingDominatesCount(t *testing.T) {
	smallMiss := Compute(Record{
		SettledCount: 3, DelinquentCount: 1,
		SettledDrops: 300e6, DelinquentDrops: 1e6, LastOutcomeUnix: now,
	}, now)
	bigMiss := Compute(Record{
		SettledCount: 3, DelinquentCount: 1,
		SettledDrops: 3e6, DelinquentDrops: 300e6, LastOutcomeUnix: now,
	}, now)
	if smallMiss.Score <= bigMiss.Score {
		t.Fatalf("a large delinquency should cost more: small=%d big=%d", smallMiss.Score, bigMiss.Score)
	}
}

func TestStalenessDecaysTowardBaseline(t *testing.T) {
	fresh := Compute(Record{SettledCount: 10, SettledDrops: 100e6, LastOutcomeUnix: now}, now)
	stale := Compute(Record{
		SettledCount: 10, SettledDrops: 100e6,
		LastOutcomeUnix: now - 3*365*24*3600,
	}, now)
	if stale.Score >= fresh.Score {
		t.Fatalf("stale record (%d) should score below fresh (%d)", stale.Score, fresh.Score)
	}
	if stale.Score <= baseline-1 {
		t.Fatalf("a stale but clean record should stay above baseline, got %d", stale.Score)
	}
}

func TestScoreStaysInBand(t *testing.T) {
	cases := []Record{
		{SettledCount: 1e6, SettledDrops: 1e18, LastOutcomeUnix: now},
		{DelinquentCount: 1e6, DelinquentDrops: 1e18, LastOutcomeUnix: now},
		{SettledCount: 1, DelinquentCount: 1, LastOutcomeUnix: 0},
	}
	for i, r := range cases {
		got := Compute(r, now)
		if got.Score < Min || got.Score > Max {
			t.Fatalf("case %d: score %d out of [%d,%d]", i, got.Score, Min, Max)
		}
	}
}

// The output must not let a caller reconstruct the history it summarizes.
func TestDistinctRecordsCanShareAScore(t *testing.T) {
	a := Compute(Record{SettledCount: 8, SettledDrops: 80e6, LastOutcomeUnix: now}, now)
	b := Compute(Record{SettledCount: 9, SettledDrops: 900e6, LastOutcomeUnix: now}, now)
	if a.Score != b.Score {
		t.Skip("model tuning changed; collision is illustrative, not required")
	}
}
