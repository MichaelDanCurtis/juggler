// Copyright (c) 2026 Julian Storer
// AGPL-3.0-or-later - see LICENSE

// Package userpaths is the single source of truth for Facet's per-user
// directories: durable config and the regenerable cache beneath it.
//
// On Linux (and other Unixes) these follow the XDG Base Directory Specification,
// so Facet keeps its state where well-behaved software is expected to:
//
//	ConfigDir  $XDG_CONFIG_HOME/facet   (default ~/.config/facet)
//	CacheDir   $XDG_CACHE_HOME/facet    (default ~/.cache/facet)
//
// macOS and Windows keep the historical single-folder layout — durable config in
// ~/.facet and its regenerable cache in ~/.facet/cache — since neither
// follows XDG by convention. Logs live in neither tree on any platform: see
// internal/logpaths, which resolves them to the platform-conventional log
// directory (XDG_STATE_HOME on Linux).
//
// FACET_CONFIG_DIR overrides the config location outright on every platform and
// keeps the cache nested beneath it (<dir>/cache), so a single environment
// variable still relocates ALL per-user state to one portable folder — which is
// how CI and tests isolate state per run.
//
// A one-time Migrate moves a pre-XDG ~/.facet tree into the XDG directories on
// Linux; see Migrate.
package userpaths

import (
	"os"
	"path/filepath"
	"runtime"
)

// ConfigDir returns Facet's per-user config directory (credentials, default
// model, extensions, sessions, recents metadata).
//
// FACET_CONFIG_DIR overrides it outright when set, relocating every piece of
// per-user state to that directory. CI and tests use this to isolate state per
// run, so concurrent or back-to-back runs on a shared/persistent machine never
// bleed into each other; it also lets a user keep a portable config location.
//
// Otherwise it is the platform-conventional config directory (see the package
// doc), falling back to the OS temp dir when the home directory can't be
// resolved, so a path is always produced.
func ConfigDir() string {
	if dir := os.Getenv("FACET_CONFIG_DIR"); dir != "" {
		return dir
	}
	home, _ := os.UserHomeDir()
	return resolveConfigDir(runtime.GOOS, home, os.Getenv)
}

// resolveConfigDir computes the platform-conventional config directory from
// injected inputs (GOOS, home, an env lookup), so every OS branch is unit-
// testable from any host. Returns the OS temp dir as a last resort.
func resolveConfigDir(goos, home string, getenv func(string) string) string {
	switch goos {
	case "darwin", "windows":
		if home != "" {
			return filepath.Join(home, ".facet")
		}
	default: // Linux and other Unixes — XDG Base Directory spec.
		if xdg := getenv("XDG_CONFIG_HOME"); xdg != "" {
			return filepath.Join(xdg, "facet")
		}
		if home != "" {
			return filepath.Join(home, ".config", "facet")
		}
	}
	return filepath.Join(os.TempDir(), "facet")
}

// CacheDir returns the regenerable cache directory. Files here are safe to
// delete — Facet rebuilds them on demand. Callers MkdirAll it before writing.
//
// When FACET_CONFIG_DIR is set the cache is nested beneath it (<dir>/cache) so
// one override still isolates cache along with config. Otherwise it is the
// platform-conventional cache directory (see the package doc): a sibling of
// ConfigDir on Linux ($XDG_CACHE_HOME/facet), nested inside it on
// macOS/Windows (~/.facet/cache).
func CacheDir() string {
	if dir := os.Getenv("FACET_CONFIG_DIR"); dir != "" {
		return filepath.Join(dir, "cache")
	}
	home, _ := os.UserHomeDir()
	return resolveCacheDir(runtime.GOOS, home, os.Getenv)
}

// resolveCacheDir computes the platform-conventional cache directory from
// injected inputs, mirroring resolveConfigDir. The homeless fallback nests the
// cache under the config fallback so the two stay related when there is nowhere
// conventional to put them.
func resolveCacheDir(goos, home string, getenv func(string) string) string {
	switch goos {
	case "darwin", "windows":
		if home != "" {
			return filepath.Join(home, ".facet", "cache")
		}
	default: // Linux and other Unixes — XDG Base Directory spec.
		if xdg := getenv("XDG_CACHE_HOME"); xdg != "" {
			return filepath.Join(xdg, "facet")
		}
		if home != "" {
			return filepath.Join(home, ".cache", "facet")
		}
	}
	return filepath.Join(os.TempDir(), "facet", "cache")
}

// Migrate performs the one-time relocation of a pre-XDG ~/.facet tree into the
// XDG config and cache directories on Linux. It is best-effort and idempotent,
// and is a no-op when:
//   - FACET_CONFIG_DIR is set (explicit override — never touch the user tree),
//   - the platform default is unchanged (macOS/Windows still use ~/.facet),
//   - there is no legacy ~/.facet to move, or
//   - the destination already exists (we never clobber or merge into it).
//
// Safe to call from every process at startup: a same-filesystem os.Rename is
// atomic, so two facet processes racing at first launch resolve to a single
// winner and the loser simply sees the destination already present. logf (e.g.
// jlog.Info) reports what was moved; pass nil to stay silent.
//
// MIGRATION(xdg, remove-by v0.6.0): this whole seam (Migrate + migrate below,
// its two startup call sites, and its tests) is temporary. TestMigrationTombstone
// fails when VERSION reaches the remove-by; delete everything marked MIGRATION(xdg).
func Migrate(logf func(string, ...any)) {
	if os.Getenv("FACET_CONFIG_DIR") != "" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return
	}
	migrate(runtime.GOOS, home, os.Getenv, logf)
}

// migrate is the injectable core of Migrate (GOOS, home, env, logger), so its
// behaviour is unit-testable from any host.
func migrate(goos, home string, getenv func(string) string, logf func(string, ...any)) {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	legacy := filepath.Join(home, ".facet")
	newConfig := resolveConfigDir(goos, home, getenv)
	// Nothing to relocate when the default path is unchanged (macOS/Windows).
	if newConfig == legacy || !isDir(legacy) {
		return
	}
	// Move config only when the destination doesn't yet exist, so we never
	// clobber or merge into an already-populated XDG dir.
	if !pathExists(newConfig) {
		if err := os.MkdirAll(filepath.Dir(newConfig), 0o755); err != nil {
			return
		}
		if err := os.Rename(legacy, newConfig); err != nil {
			logf("user-config migration skipped (%s → %s): %v", legacy, newConfig, err)
			return
		}
		logf("migrated user config: %s → %s", legacy, newConfig)
	}
	// Lift the cache out of the relocated tree into the XDG cache root. After the
	// config move the legacy cache sits at <newConfig>/cache.
	newCache := resolveCacheDir(goos, home, getenv)
	oldCache := filepath.Join(newConfig, "cache")
	if newCache == oldCache || !isDir(oldCache) || pathExists(newCache) {
		return
	}
	if err := os.MkdirAll(filepath.Dir(newCache), 0o755); err != nil {
		return
	}
	if err := os.Rename(oldCache, newCache); err != nil {
		logf("user-cache migration skipped (%s → %s): %v", oldCache, newCache, err)
		return
	}
	logf("migrated user cache: %s → %s", oldCache, newCache)
}

// pathExists reports whether path exists (file or directory).
func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// isDir reports whether path exists and is a directory.
func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}
