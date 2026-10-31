import type { Metadata } from "next";
import { getAdminContext } from "../admin-context";
import { EmptyList, ListHeader, Row, RowList } from "../admin-list";
import { noticeText } from "../labels";
import { NoAccess } from "../no-access";
import { listOffices } from "../organization";

export const metadata: Metadata = { title: "Kontorer" };

/** Kontorene i organisasjonen, sortert på rekkefølge og navn. Bare admin. */
export default async function OfficesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const offices = await listOffices(context.actor, context.organizationId);
  const notice = noticeText((await searchParams).lagret);

  return (
    <main className="max-w-4xl">
      <ListHeader
        title="Kontorer"
        actionLabel="Nytt kontor"
        actionHref="/admin/kontorer/ny"
        notice={notice}
      />
      {offices.length === 0 ? (
        <EmptyList text="Ingen kontorer ennå." />
      ) : (
        <RowList>
          {offices.map((office) => (
            <Row key={office.id} href={`/admin/kontorer/${office.id}`} title={office.name}>
              {office.address && (
                <span className="block text-sm text-slate-600">{office.address}</span>
              )}
            </Row>
          ))}
        </RowList>
      )}
    </main>
  );
}
