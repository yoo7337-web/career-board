// ─────────────────────────────────────────────────────────────
// Firebase 설정 (클라우드 동기화용)
//
// Firebase 콘솔 > 프로젝트 설정(⚙) > 일반 > 내 앱 > "SDK 설정 및 구성"에서 얻은 값.
// apiKey는 웹 앱에서 공개되어도 되는 값입니다. 보안은 로그인 + Firestore 규칙으로 지킵니다.
// ─────────────────────────────────────────────────────────────
// ── 구글 캘린더 동기화용 OAuth 클라이언트 ID (선택) ──
// Google Cloud 콘솔 > API 및 서비스 > 사용자 인증 정보 > OAuth 웹 클라이언트 ID.
// PASTE 상태면 동기화 버튼이 숨겨집니다.
window.gcalClientId = "699122227963-o53796j8lctd8fvjcmdae22uvclpv4a1.apps.googleusercontent.com";

window.firebaseConfig = {
  apiKey: "AIzaSyDqanuN7rQmx6R1peTzn3SJf_3TkBZpyyw",
  authDomain: "career-board-fc111.firebaseapp.com",
  projectId: "career-board-fc111",
  storageBucket: "career-board-fc111.firebasestorage.app",
  messagingSenderId: "699122227963",
  appId: "1:699122227963:web:80cb1eacf148bef29b6e5e",
  measurementId: "G-EBPTZZF406"
};
