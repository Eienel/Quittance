package registry

import (
	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
)

func ethereumCallMsg(to common.Address, data []byte) ethereum.CallMsg {
	return ethereum.CallMsg{To: &to, Data: data}
}
