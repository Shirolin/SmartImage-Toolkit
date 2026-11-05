// Package ops holds the operator contract shared by every image operation:
// one result type, one batch runner, and one way to report progress.
package ops

import (
	"context"
	"sync"
)

// Status values reported by an operation.
const (
	StatusSuccess  = "success"
	StatusError    = "error"
	StatusSkipped  = "skipped"
	StatusCanceled = "canceled"
)

// Result is the outcome of one file, mirroring the Node OpResult shape plus
// the sizes the desktop UI shows.
type Result struct {
	Status     string
	File       string
	Output     string
	Reason     string
	InputSize  int64
	OutputSize int64
	// Width and Height are the output dimensions when known.
	Width, Height int
}

// Progress receives each completed file. done counts completed files and total
// is the batch size. It may run concurrently and must return quickly.
type Progress func(done, total int, r Result)

// Job processes one source file.
type Job func(ctx context.Context, src string) Result

// RunAll runs job over paths with workers goroutines, preserving result order
// in path order. Cancellation stops feeding new work; in-flight jobs decide
// whether they finish or report StatusCanceled.
func RunAll(ctx context.Context, paths []string, workers int, job Job, progress Progress) []Result {
	if workers < 1 {
		workers = 1
	}
	total := len(paths)
	if total == 0 {
		return nil
	}

	jobs := make(chan int)
	results := make([]Result, total)
	var mu sync.Mutex
	var wg sync.WaitGroup
	done := 0

	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := range jobs {
				r := job(ctx, paths[i])
				mu.Lock()
				results[i] = r
				done++
				completed := done
				mu.Unlock()
				if progress != nil {
					progress(completed, total, r)
				}
			}
		}()
	}

feed:
	for i := range paths {
		select {
		case <-ctx.Done():
			break feed
		case jobs <- i:
		}
	}
	close(jobs)
	wg.Wait()

	// A canceled batch leaves unfed entries zero-valued; report them as
	// canceled so the UI does not keep them as running forever.
	finished := results[:0]
	for _, r := range results {
		if r.Status == "" {
			r.Status = StatusCanceled
		}
		finished = append(finished, r)
	}
	return finished
}
