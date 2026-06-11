/**
 * Trainers roster — discoverable entry point for the Trainer Intelligence
 * Graph (F1) and AI Trainer Score Card (F2). Lists every user with
 * role='trainer'; each row links to /trainers/:id.
 *
 * Page-level visibility: admin + coordinator only (matches the route
 * gating in App.tsx — trainers don't drill into other trainers' analytics).
 */

import { Link } from "wouter";
import { useListUsers } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BrainCircuit, ArrowRight, Mail } from "lucide-react";

export default function Trainers() {
  const { data: users, isLoading } = useListUsers();
  const trainers = (users ?? []).filter((u) => u.role === "trainer");

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Trainers</h1>
          <p className="text-muted-foreground">
            Open a trainer to see their AI effectiveness score and the
            Intelligence Graph of their batches and candidates.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Trainer roster
            </CardTitle>
            <CardDescription>
              {isLoading ? "Loading…" : `${trainers.length} trainer${trainers.length === 1 ? "" : "s"}`}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Profile</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && trainers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No trainers in the system yet. Add one from <Link href="/users" className="underline">Users</Link>.
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && trainers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5" />
                      {t.email}
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/trainers/${t.id}`}>
                        <Button size="sm" variant="outline" className="gap-1.5">
                          Open profile
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
