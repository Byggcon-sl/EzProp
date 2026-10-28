import { redirect } from "next/navigation";
import { getCurrentActor, LOGIN_PATH } from "@/core/auth/session";

/** Forsiden: innloggede går til arbeidskøen, andre til innlogging. */
export default async function HomePage() {
  redirect((await getCurrentActor()) ? "/arbeidskoe" : LOGIN_PATH);
}
