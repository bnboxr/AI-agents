// Stargate Router ABI — minimal: swap (bridge)
export const ABI = [
  {
    inputs: [
      { name: '_dstChainId', type: 'uint16' },
      { name: '_srcPoolId', type: 'uint256' },
      { name: '_dstPoolId', type: 'uint256' },
      { name: '_refundAddress', type: 'address' },
      { name: '_amountLD', type: 'uint256' },
      { name: '_minAmountLD', type: 'uint256' },
      {
        components: [
          { name: 'dstGasForCall', type: 'uint256' },
          { name: 'dstNativeAmount', type: 'uint256' },
          { name: 'dstNativeAddr', type: 'bytes' },
        ],
        name: '_lzTxParams',
        type: 'tuple',
      },
      { name: '_to', type: 'bytes' },
      { name: '_payload', type: 'bytes' },
    ],
    name: 'swap',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
] as const;
