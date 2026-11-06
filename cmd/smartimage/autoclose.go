package main

import (
	"time"

	"github.com/Shirolin/SmartImage-Toolkit/internal/output"
)

// A quick conversion started from the file context menu is fire-and-forget:
// once it finishes, the window counts down and closes, unless the user
// dismisses the prompt or touches the queue. Manually opened windows never
// close on their own.
const closeCountdownSeconds = 3

// shouldAutoClose reports whether the batch that just finished may close the
// window. Failures and cancellations keep the window open so their reason
// stays readable.
func (a *app) shouldAutoClose(op output.Op) bool {
	return op == output.Convert && a.quickLaunch && !a.busy && !a.draining &&
		len(a.pendingPaths) == 0 && a.runFailed == 0 && a.runCanceled == 0
}

// maybeAutoClose starts the countdown when the finished batch qualifies.
func (a *app) maybeAutoClose(op output.Op) {
	if !a.shouldAutoClose(op) {
		return
	}
	a.countdownGen++
	a.countdown = closeCountdownSeconds
	a.armCountdown(a.countdownGen)
}

// armCountdown ticks once a second. Every tick re-checks gen so a dismissed
// or replaced countdown is inert.
func (a *app) armCountdown(gen int) {
	time.AfterFunc(time.Second, func() {
		a.update(func() {
			if gen != a.countdownGen || a.countdown == 0 {
				return
			}
			a.countdown--
			if a.countdown > 0 {
				a.armCountdown(gen)
				return
			}
			a.countdownGen++
			if a.win != nil {
				a.win.Close()
			}
		})
	})
}

// stopCountdown drops a pending countdown without changing whether the
// session may close itself.
func (a *app) stopCountdown() {
	a.countdownGen++
	a.countdown = 0
}

// cancelAutoClose keeps the window open for the rest of the session. It runs
// when the prompt is dismissed or the user starts adding work by hand.
func (a *app) cancelAutoClose() {
	a.quickLaunch = false
	a.stopCountdown()
}
