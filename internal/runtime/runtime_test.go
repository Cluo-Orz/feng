package runtime

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGoRuntimeGrowStatusCheck(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer

	code := Run([]string{"grow", "make a tiny agent", "--max-turns", "1"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), "missing_config") {
		t.Fatalf("grow did not report missing_config: %s", out.String())
	}
	if _, err := os.Stat(filepath.Join(dir, ".feng", "state.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "skills", "README.md")); err != nil {
		t.Fatal(err)
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"status"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("status exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"mode": "missing_config"`) {
		t.Fatalf("status did not expose missing_config: %s", out.String())
	}

	out.Reset()
	errOut.Reset()
	code = Run([]string{"check"}, dir, &out, &errOut)
	if code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	if !strings.Contains(out.String(), `"ok": true`) {
		t.Fatalf("check did not pass: %s", out.String())
	}
	if !strings.Contains(out.String(), `"validated_commit": "`) {
		t.Fatalf("check did not report validated commit: %s", out.String())
	}
}

func TestGoRuntimeNoBootstrapCommand(t *testing.T) {
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	code := Run([]string{"bootstrap"}, dir, &out, &errOut)
	if code != 2 {
		t.Fatalf("bootstrap should not be public, exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
}

func TestGoRuntimeHatchCreatesPackage(t *testing.T) {
	t.Setenv("DEEPSEEK_API_KEY", "")
	dir := t.TempDir()
	var out, errOut bytes.Buffer
	if code := Run([]string{"grow", "make a portable agent", "--max-turns", "1"}, dir, &out, &errOut); code != 2 {
		t.Fatalf("grow exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"check"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("check exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	out.Reset()
	errOut.Reset()
	if code := Run([]string{"hatch", "--name", "sample", "--portable"}, dir, &out, &errOut); code != 0 {
		t.Fatalf("hatch exit=%d stdout=%s stderr=%s", code, out.String(), errOut.String())
	}
	packagePath := strings.TrimSpace(out.String())
	if _, err := os.Stat(filepath.Join(packagePath, "self", "identity.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "feng-release.yaml")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(packagePath, "checksums.json")); err != nil {
		t.Fatal(err)
	}
}
