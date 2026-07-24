// Main-thread liveness probe and macOS sleep/wake observers.
//
// The hidden engine WKWebView uses WKInactiveSchedulingPolicyNone
// (KeepRunningWhenHidden), which keeps its CVDisplayLink running while
// hidden — including across system sleep/wake. WebKit has a lock-ordering
// bug in this path: the CVDisplayLink IO callback can call
// CVDisplayLink::stop() from inside its own callback while holding
// WebKit::DisplayLink's lock, deadlocking against the main thread when it
// tries to addObserver. We can't fix WebKit, but we CAN detect that the
// main thread has stopped pumping its run loop and force-exit so the
// lockfile-based relaunch can take over.
//
// facet_mainthread_pong_counter() returns an atomic counter that is
// incremented by a block dispatched to the main queue. The Go watchdog
// captures it, calls facet_mainthread_ping(), waits, and re-reads. If it
// did not advance, the main thread is wedged.
//
// facet_register_sleepwake_observers() wires NSWorkspace notifications
// to Go-side callbacks so the watchdog can expedite its next check after
// the system wakes (the only time the WebKit deadlock has been observed).

#import <AppKit/AppKit.h>
#import <stdatomic.h>

extern void facetOnWillSleep(void);
extern void facetOnDidWake(void);

static _Atomic unsigned long long g_mainthread_pong = 0;

void facet_mainthread_ping(void) {
    // dispatch_async to the main queue: if the main thread is pumping its
    // run loop normally, this block executes within milliseconds. If the
    // main thread is wedged inside a lock (WebKit deadlock, anything in C
    // that holds Cocoa hostage, etc.), the block never runs and the
    // counter stays put.
    dispatch_async(dispatch_get_main_queue(), ^{
        atomic_fetch_add_explicit(&g_mainthread_pong, 1, memory_order_relaxed);
    });
}

unsigned long long facet_mainthread_pong_counter(void) {
    return atomic_load_explicit(&g_mainthread_pong, memory_order_relaxed);
}

void facet_register_sleepwake_observers(void) {
    NSNotificationCenter *nc = [[NSWorkspace sharedWorkspace] notificationCenter];
    [nc addObserverForName:NSWorkspaceWillSleepNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification *note) {
        (void)note;
        facetOnWillSleep();
    }];
    [nc addObserverForName:NSWorkspaceDidWakeNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification *note) {
        (void)note;
        facetOnDidWake();
    }];
}

// App Nap defeat lives in the osactivity package now: it's per-request,
// refcounted, and scoped to active work rather than always-on.
