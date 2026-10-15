package a

import "example.com/graphfixture/b"

func FunctionA(n int) int {
	return b.FunctionB(n) + 1
}
