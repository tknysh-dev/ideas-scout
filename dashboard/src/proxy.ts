import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getAuthEnv } from "@/lib/config";

// Next.js 16: middleware.ts перейменовано на proxy.ts. Файл мусить лежати на
// одному рівні з `app/` — тобто в `src/`, а не в корені проєкту: у корені
// Next його просто не реєструє (middleware-manifest.json лишається порожнім),
// і гейт авторизації не виконується жодного разу.
const PUBLIC_PATHS = ["/login", "/api/auth"];

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

// Поведінка, коли AUTH_* не заповнені. У dev пускаємо все, щоб можна було
// працювати без OAuth-застосунку; у проді — навпаки, закриваємо все, крім
// /login, яка пояснить, яких env бракує. Fail closed: попередня версія при
// відсутності env пускала всіх, і в проді це означало відкритий дашборд.
function unconfigured(request: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  if (isPublic(request.nextUrl.pathname)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.nextUrl));
}

const gate = auth((request) => {
  const { pathname } = request.nextUrl;
  // signIn-колбек в auth.ts не дає видати сесію нікому, крім
  // ALLOWED_GITHUB_LOGIN, але login звіряємо ще й тут: так уже видані сесії
  // перестають діяти одразу після зміни allow-list, а не доживають свій строк.
  const signedIn = request.auth?.user?.login === getAuthEnv()?.allowedLogin;

  if (!signedIn && !isPublic(pathname)) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  if (signedIn && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.nextUrl));
  }

  return NextResponse.next();
});

export default getAuthEnv() ? gate : unconfigured;

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
