declare module 'sm-crypto' {
  export const sm2: {
    doDecrypt(ciphertext: string, privateKey: string, cipherMode?: 0 | 1): string;
  };

  export const sm3: (value: string) => string;

  const api: { sm2: typeof sm2; sm3: typeof sm3 };
  export default api;
}
