/** The package ships no types; the ESM build default-exports one function: seed → SVG string. */
declare module '@multiavatar/multiavatar/esm' {
  export default function multiavatar(seed: string, sansEnv?: boolean, ver?: { part: string; theme: string }): string;
}
