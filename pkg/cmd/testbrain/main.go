package main

import (
	"fmt"
	"github.com/gulindev/gulin/pkg/gulinapp"
	"os"
)

func main() {
	os.Setenv("GULIN_CONFIG_DIR", "/Users/lordzero1/Gulin_Workspace/config")
	os.Setenv("GULIN_DATA_DIR", "/Users/lordzero1/Gulin_Workspace/data")
	
	err := gulinapp.InitBrainDB()
	if err != nil {
		fmt.Printf("Error: %v\n", err)
	} else {
		fmt.Println("Success!")
	}
}
