import { redirect } from "next/navigation";

// "/" is only a router alias for the overview — but the emailed auth links
// (verification: /?verified=1, reset/welcome: /?screen=set-password&token=…)
// land here too, and AuthScreens reads them from window.location.search on
// whatever route the unauthenticated shell renders. Forward the query string
// so the redirect doesn't strip those params.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else if (value !== undefined) params.set(key, value);
  }
  const qs = params.toString();
  redirect(qs ? `/overview?${qs}` : "/overview");
}
