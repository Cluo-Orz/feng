package main

import (
	"os"

	"feng/internal/runtime"
)

func main() {
	os.Exit(runtime.Run(os.Args[1:], "", os.Stdout, os.Stderr))
}
