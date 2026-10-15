package a

import (
	"testing"

	"example.com/graphfixture/b"
)

func TestFunctionB(t *testing.T) {
	if b.FunctionB(2) != 4 {
		t.Fatal("expected 4")
	}
}
