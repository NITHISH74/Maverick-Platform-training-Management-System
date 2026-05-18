import { useRoute } from "wouter";
import { useGetBatch, getGetBatchQueryKey, useListBatchCandidates, getListBatchCandidatesQueryKey, useListAttendance, getListAttendanceQueryKey, useListAssessments, getListAssessmentsQueryKey, useListToppers, getListToppersQueryKey, useGetAttendanceSummary, getGetAttendanceSummaryQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Users, Calendar, UserCheck, Trophy } from "lucide-react";
import { Link } from "wouter";
import { Progress } from "@/components/ui/progress";

export default function BatchDetail({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  
  const { data: batch, isLoading: isBatchLoading } = useGetBatch(id, {
    query: {
      enabled: !!id,
      queryKey: getGetBatchQueryKey(id),
    }
  });

  const { data: candidates, isLoading: isCandidatesLoading } = useListBatchCandidates(id, {
    query: {
      enabled: !!id,
      queryKey: getListBatchCandidatesQueryKey(id),
    }
  });

  const { data: attendanceSummary, isLoading: isAttendanceLoading } = useGetAttendanceSummary({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getGetAttendanceSummaryQueryKey({ batchId: id }),
    }
  });

  const { data: assessments, isLoading: isAssessmentsLoading } = useListAssessments({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getListAssessmentsQueryKey({ batchId: id }),
    }
  });

  const { data: toppers, isLoading: isToppersLoading } = useListToppers({ batchId: id }, {
    query: {
      enabled: !!id,
      queryKey: getListToppersQueryKey({ batchId: id }),
    }
  });

  return (
    <Layout>
      <div className="space-y-6">
        {isBatchLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ) : batch ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{batch.name}</h1>
                <Badge variant={batch.status === 'running' ? 'default' : 'secondary'} className="uppercase text-xs">{batch.status}</Badge>
              </div>
              <p className="text-muted-foreground font-mono mt-1 text-sm">{batch.batchCode} • {batch.program}</p>
            </div>
            
            <div className="flex gap-4">
              <Card className="px-4 py-2 border-border shadow-sm flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Users className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Candidates</p>
                  <p className="font-bold text-sm">{batch.candidateCount || 0} / {batch.capacity}</p>
                </div>
              </Card>
              <Card className="px-4 py-2 border-border shadow-sm flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-md text-primary">
                  <Calendar className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Timeline</p>
                  <p className="font-bold text-sm">{format(new Date(batch.startDate), "MMM d")} - {format(new Date(batch.endDate), "MMM d, yyyy")}</p>
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        <Tabs defaultValue="candidates" className="w-full mt-6">
          <TabsList className="grid w-full grid-cols-4 max-w-[600px]">
            <TabsTrigger value="candidates">Candidates</TabsTrigger>
            <TabsTrigger value="attendance">Attendance</TabsTrigger>
            <TabsTrigger value="assessments">Assessments</TabsTrigger>
            <TabsTrigger value="toppers">Toppers</TabsTrigger>
          </TabsList>
          
          <TabsContent value="candidates" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader>
                <CardTitle>Batch Candidates</CardTitle>
                <CardDescription>All enrolled candidates for this batch.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isCandidatesLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading candidates...</TableCell>
                      </TableRow>
                    ) : candidates?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center py-8 text-muted-foreground border-t border-dashed">No candidates enrolled yet.</TableCell>
                      </TableRow>
                    ) : candidates?.map((candidate) => (
                      <TableRow key={candidate.id} className="hover:bg-muted/50 transition-colors">
                        <TableCell className="font-mono text-sm">{candidate.candidateId}</TableCell>
                        <TableCell className="font-medium">{candidate.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="uppercase text-[10px]">{candidate.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link href={`/candidates/${candidate.id}`} className="text-primary hover:underline text-sm font-medium">
                            View Profile
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="attendance" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader>
                <CardTitle>Attendance Summary</CardTitle>
                <CardDescription>Cumulative attendance metrics per candidate.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Candidate</TableHead>
                      <TableHead className="text-right">Present</TableHead>
                      <TableHead className="text-right">Absent</TableHead>
                      <TableHead className="text-right">Leave/Late</TableHead>
                      <TableHead className="text-right w-[200px]">Compliance (%)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isAttendanceLoading ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading attendance...</TableCell>
                      </TableRow>
                    ) : attendanceSummary?.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground border-t border-dashed">No attendance records found.</TableCell>
                      </TableRow>
                    ) : attendanceSummary?.map((record) => (
                      <TableRow key={record.candidateId}>
                        <TableCell className="font-medium">
                          <Link href={`/candidates/${record.candidateId}`} className="hover:underline">
                            {record.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right text-green-600 font-medium">{record.presentDays}</TableCell>
                        <TableCell className="text-right text-destructive font-medium">{record.absentDays}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{record.leaveDays + record.lateDays}</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-2">
                            <span className="text-sm font-mono w-10 text-right">{Math.round(record.attendancePercent)}%</span>
                            <Progress 
                              value={record.attendancePercent} 
                              className="h-2 w-24"
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="assessments" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
             <Card>
              <CardHeader>
                <CardTitle>Batch Assessments</CardTitle>
                <CardDescription>Scheduled and completed evaluations.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Max Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isAssessmentsLoading ? (
                       <TableRow>
                         <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Loading assessments...</TableCell>
                       </TableRow>
                     ) : assessments?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={4} className="text-center py-8 text-muted-foreground border-t border-dashed">No assessments scheduled.</TableCell>
                       </TableRow>
                     ) : assessments?.map((assessment) => (
                      <TableRow key={assessment.id}>
                        <TableCell className="font-medium">{assessment.title}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize text-[10px]">
                            {assessment.type.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{format(new Date(assessment.scheduledDate), "MMM d, yyyy")}</TableCell>
                        <TableCell className="text-right font-mono">{assessment.maxScore}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="toppers" className="mt-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Top Performers
                </CardTitle>
                <CardDescription>Ranked by composite performance score.</CardDescription>
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
                    {isToppersLoading ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading leaderboard...</TableCell>
                       </TableRow>
                     ) : toppers?.length === 0 ? (
                       <TableRow>
                         <TableCell colSpan={6} className="text-center py-8 text-muted-foreground border-t border-dashed">No topper data calculated yet.</TableCell>
                       </TableRow>
                     ) : toppers?.map((topper) => (
                      <TableRow key={topper.id} className={topper.rank <= 3 ? "bg-muted/30" : ""}>
                        <TableCell className="text-center">
                          {topper.rank === 1 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500 text-xs font-bold text-white shadow-sm">1</span>
                          ) : topper.rank === 2 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs font-bold text-slate-800 shadow-sm">2</span>
                          ) : topper.rank === 3 ? (
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-xs font-bold text-white shadow-sm">3</span>
                          ) : (
                            <span className="font-mono text-muted-foreground">{topper.rank}</span>
                          )}
                        </TableCell>
                        <TableCell className="font-medium">
                          <Link href={`/candidates/${topper.candidateId}`} className="hover:underline">
                            {topper.candidateName}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.assessmentScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.projectScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{Math.round(topper.attendanceScore || 0)}</TableCell>
                        <TableCell className="text-right font-mono font-bold text-primary">{Math.round(topper.totalScore * 100) / 100}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
