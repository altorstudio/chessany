// Small user preferences persisted in localStorage.

function getString(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function setString(key: string, value: string): void {
  try {
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(key, trimmed);
    else localStorage.removeItem(key);
  } catch {
    /* ignore quota / unavailable storage */
  }
}

const LICHESS_USER_KEY = "chessany.lichessUser";
const CHESSCOM_USER_KEY = "chessany.chesscomUser";

export const getLichessUser = () => getString(LICHESS_USER_KEY);
export const setLichessUser = (user: string) => setString(LICHESS_USER_KEY, user);
export const getChessComUser = () => getString(CHESSCOM_USER_KEY);
export const setChessComUser = (user: string) => setString(CHESSCOM_USER_KEY, user);
