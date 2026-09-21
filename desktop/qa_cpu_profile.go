package main

// This file supports the one-off v1.38.11-1 Windows CPU investigation. The
// profiler is completely dormant unless the QA workflow supplies an explicit
// output path, and the branch is not part of the release control plane.

import (
	"os"
	"path/filepath"
	"runtime/pprof"
	"sync"
	"time"
)

const qaCPUProfileEnvironment = "REASONIX_QA_CPU_PROFILE"

func startQACPUProfileFromEnvironment() func() {
	path := os.Getenv(qaCPUProfileEnvironment)
	if path == "" {
		return func() {}
	}
	var mu sync.Mutex
	var file *os.File
	started, stopped := false, false
	stop := func() {
		mu.Lock()
		defer mu.Unlock()
		if stopped {
			return
		}
		stopped = true
		if started {
			pprof.StopCPUProfile()
			_ = file.Close()
		}
	}
	time.AfterFunc(15*time.Second, func() {
		mu.Lock()
		defer mu.Unlock()
		if stopped {
			return
		}
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		var err error
		file, err = os.Create(path)
		if err != nil {
			stopped = true
			return
		}
		if err := pprof.StartCPUProfile(file); err != nil {
			_ = file.Close()
			stopped = true
			return
		}
		started = true
		time.AfterFunc(45*time.Second, stop)
	})
	return stop
}
