package ops

import (
	"context"
	"testing"
	"time"
)

func TestRunAllKeepsPathOrder(t *testing.T) {
	paths := []string{"a", "b", "c"}
	results := RunAll(context.Background(), paths, 3, func(_ context.Context, src string) Result {
		if src == "a" {
			time.Sleep(20 * time.Millisecond)
		}
		return Result{Status: StatusSuccess, File: src}
	}, nil)

	if len(results) != len(paths) {
		t.Fatalf("results = %d, want %d", len(results), len(paths))
	}
	for i, want := range paths {
		if results[i].File != want {
			t.Fatalf("results[%d] = %q, want %q", i, results[i].File, want)
		}
	}
}

func TestRunAllMarksUnstartedAsCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	results := RunAll(ctx, []string{"a", "b"}, 1, func(_ context.Context, src string) Result {
		return Result{Status: StatusSuccess, File: src}
	}, nil)

	if len(results) != 2 {
		t.Fatalf("results = %d, want 2", len(results))
	}
	for i, r := range results {
		if r.Status != StatusCanceled {
			t.Fatalf("results[%d].Status = %q, want canceled", i, r.Status)
		}
	}
}
