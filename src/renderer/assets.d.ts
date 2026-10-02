/** Vite podaje adres pliku graficznego zaimportowanego jak moduł. */
declare module '*.svg' {
  const src: string;
  export default src;
}
