package main

import (
	"os"

	"feng/internal/runtime"
)

func main() {
	os.Exit(runtime.RunWithExecutable(os.Args[1:], "", os.Stdout, os.Stderr, os.Args[0]))
}
