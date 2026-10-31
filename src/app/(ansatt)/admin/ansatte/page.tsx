import type { Metadata } from "next";
import { Badge } from "@/shared/ui/badge";
import { getAdminContext } from "../admin-context";
import { EmptyList, ListHeader, Row, RowList } from "../admin-list";
import { noticeText, roleBadgeOrder, roleLabels } from "../labels";
import { NoAccess } from "../no-access";
import { listEmployeesForAdmin } from "@/core/organization";

export const metadata: Metadata = { title: "Ansatte" };

type AdminEmployee = Awaited<ReturnType<typeof listEmployeesForAdmin>>[number];

function EmployeeRow({ employee }: { employee: AdminEmployee }) {
  const sluttet = employee.deactivatedAt !== null;
  const details = [employee.jobTitle, employee.companyName, employee.officeName].filter(Boolean);
  const roles = roleBadgeOrder.filter((role) => employee.roles.includes(role));
  return (
    <Row href={`/admin/ansatte/${employee.id}`} title={employee.name} muted={sluttet}>
      {details.length > 0 && (
        <span className="block text-sm text-slate-600">{details.join(" · ")}</span>
      )}
      {employee.email && (
        <span className="block text-sm break-all text-slate-600">{employee.email}</span>
      )}
      <span className="mt-1 flex flex-wrap gap-1.5">
        {sluttet ? (
          <Badge>Sluttet</Badge>
        ) : roles.length === 0 ? (
          <Badge>Ingen roller</Badge>
        ) : (
          roles.map((role) => (
            <Badge key={role} tone={role === "admin" ? "brand" : "neutral"}>
              {roleLabels[role]}
            </Badge>
          ))
        )}
      </span>
    </Row>
  );
}

/** Ansatte i organisasjonen. De som har sluttet, står i eget kort nederst. Bare admin. */
export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAdminContext();
  if (!context) return <NoAccess />;
  const employees = await listEmployeesForAdmin(context.actor, context.organizationId);
  const notice = noticeText((await searchParams).lagret);
  const active = employees.filter((employee) => employee.deactivatedAt === null);
  const former = employees.filter((employee) => employee.deactivatedAt !== null);

  return (
    <main className="max-w-4xl">
      <ListHeader
        title="Ansatte"
        actionLabel="Ny ansatt"
        actionHref="/admin/ansatte/ny"
        notice={notice}
      />
      {active.length === 0 ? (
        <EmptyList text="Ingen ansatte ennå." />
      ) : (
        <RowList>
          {active.map((employee) => (
            <EmployeeRow key={employee.id} employee={employee} />
          ))}
        </RowList>
      )}
      {former.length > 0 && (
        <section aria-labelledby="former-employees">
          <h2 id="former-employees" className="mt-10 text-lg font-semibold text-slate-900">
            Har sluttet
          </h2>
          <RowList>
            {former.map((employee) => (
              <EmployeeRow key={employee.id} employee={employee} />
            ))}
          </RowList>
        </section>
      )}
    </main>
  );
}
