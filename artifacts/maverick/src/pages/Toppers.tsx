import { useState } from "react";
import { useListBatches, useListToppers, useComputeToppers } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Trophy, RefreshCw, Settings as SettingsIcon } from "lucide-react";
import { Link } from "wouter";

export default function Toppers() {
  const [selectedBatch, setSelectedBatch] = useState<string>("");
  
  const { data: batches } = useListBatches();

  const { data: toppers, isLoading, refetch } = useListToppers(
    { batchId: selectedBatch ? parseInt(selectedBatch) : undefined },
    { query: { queryKey: ["toppers", selectedBatch], enabled: !!selectedBatch } }
  );

  const computeMutation = useComputeToppers();

  const handleCompute = () => {
    if (!selectedBatch) return;
    computeMutation.mutate({ data: { batchId: parseInt(selectedBatch) } }, {
      onSuccess: () => refetch()
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Topper Identification</h1>
            <p className="text-muted-foreground">Rank candidates based on composite scores.</p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/settings"><SettingsIcon className="mr-2 h-4 w-4"/> Edit Weights</Link>
            </Button>
          </div>
        </div>

        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Select Batch</label>
              <Select value={selectedBatch} onValueChange={setSelectedBatch}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a batch to rank" />
                </SelectTrigger>
                <SelectContent>
                  {batches?.map(b => (
                    <SelectItem key={b.id} value={b.id.toString()}>{b.name} ({b.batchCode})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleCompute} disabled={!selectedBatch || computeMutation.isPending} className="w-full sm:w-auto bg-yellow-600 hover:bg-yellow-700 text-white">
                <RefreshCw className={`mr-2 h-4 w-4 ${computeMutation.isPending ? 'animate-spin' : ''}`}/> 
                Compute Ranks
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedBatch ? (
          <Card className="animate-in fade-in slide-in-from-bottom-4 duration-500">
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                Leaderboard
              </CardTitle>
              <CardDescription>Top performers computed based on active weights configuration.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
               <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[80px] text-center">Rank</TableHead>
                      <TableHead>Candidate</TableHead>
                      <TableHead className="text-right">Assessment</TableHead>
                      <TableHead className="text-right">Project</TableHead>
                      <TableHead className="text-right">Attendance</TableHead>
                      <TableHead className="text-right text-primary font-bold">Total Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading leaderboard...</TableCell>
                       </TableRow>
                     ) : !toppers || toppers.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-12 text-muted-foreground border-t border-dashed">
                            No topper data available. Click "Compute Ranks" to generate.
                         </TableCell>
                       </TableRow>
                     ) : toppers.map((topper) => (
                      <TableRow key={topper.id} className={topper.rank <= 3 ? "bg-muted/30" : ""}>
                        <TableCell className="text-center">
                          {topper.rank === 1 ? (
                            <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-yellow-400 to-yellow-600 shadow-md text-sm font-bold text-white border border-yellow-200">1</span>
                          ) : topper.rank === 2 ? (
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-slate-300 to-slate-400 shadow-sm text-xs font-bold text-slate-800 border border-slate-200">2</span>
                          ) : topper.rank === 3 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-amber-600 to-amber-700 shadow-sm text-xs font-bold text-white border border-amber-500">3</span>
                          ) : (
                            <span className="font-mono text-muted-foreground">{topper.rank}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium text-base">
                          <Link href={`/candidates/${topper.candidateId}`} className="hover:underline">
                            {topper.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.assessmentScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.projectScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.attendanceScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-lg font-bold text-primary">{Math.round(topper.totalScore * 100) / 100}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center border border-dashed rounded-lg bg-card/50 text-muted-foreground gap-4">
            <Trophy className="h-12 w-12 text-muted-foreground/30" />
            <p>Select a batch to view or compute leaderboard</p>
          </div>
        )}
      </div>
    </Layout>
  );
}
