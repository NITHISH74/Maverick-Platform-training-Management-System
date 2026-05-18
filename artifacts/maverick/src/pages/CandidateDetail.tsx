import { useGetCandidate, getGetCandidateQueryKey, useListAssessmentScores, getListAssessmentScoresQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/Layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Mail, Phone, GraduationCap, Building, Calendar, CheckCircle2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

export default function CandidateDetail({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  
  const { data: candidate, isLoading: candidateLoading } = useGetCandidate(id, {
    query: {
      enabled: !!id,
      queryKey: getGetCandidateQueryKey(id),
    }
  });

  const { data: scores, isLoading: scoresLoading } = useListAssessmentScores({ candidateId: id }, {
    query: {
      enabled: !!id,
      queryKey: getListAssessmentScoresQueryKey({ candidateId: id }),
    }
  });

  return (
    <Layout>
      <div className="space-y-6 animate-in fade-in duration-500">
        {candidateLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ) : candidate ? (
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{candidate.name}</h1>
                <Badge variant={candidate.status === 'active' ? 'default' : 'secondary'} className="uppercase text-xs">{candidate.status}</Badge>
              </div>
              <p className="text-muted-foreground font-mono mt-1">ID: {candidate.candidateId}</p>
            </div>
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle>Profile Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {candidateLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : candidate ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="bg-primary/10 p-2 rounded-md">
                      <Mail className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium">{candidate.email}</span>
                  </div>
                  {candidate.phone && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="bg-primary/10 p-2 rounded-md">
                        <Phone className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">{candidate.phone}</span>
                    </div>
                  )}
                  {candidate.batchName && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="bg-primary/10 p-2 rounded-md">
                        <Building className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">{candidate.batchName}</span>
                    </div>
                  )}
                  {candidate.college && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="bg-primary/10 p-2 rounded-md">
                        <GraduationCap className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">
                        {candidate.college} 
                        {candidate.degree && <span className="block text-xs text-muted-foreground mt-0.5">{candidate.degree}</span>}
                      </span>
                    </div>
                  )}
                  {candidate.joinedAt && (
                    <div className="flex items-center gap-3 text-sm">
                      <div className="bg-primary/10 p-2 rounded-md">
                        <Calendar className="h-4 w-4 text-primary" />
                      </div>
                      <span className="font-medium">Joined {format(new Date(candidate.joinedAt), "MMM d, yyyy")}</span>
                    </div>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
          
          <Card className="md:col-span-2 flex flex-col">
            <CardHeader>
              <CardTitle>Assessment Performance</CardTitle>
              <CardDescription>Historical scores across all evaluated modules.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col">
              {scoresLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <Skeleton className="h-[200px] w-full" />
                </div>
              ) : scores && scores.length > 0 ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pb-4 border-b">
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Total Assessments</p>
                      <p className="text-2xl font-bold">{scores.length}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">Avg Score</p>
                      <p className="text-2xl font-bold">
                        {Math.round(scores.reduce((acc, s) => acc + (s.percentage || 0), 0) / scores.length)}%
                      </p>
                    </div>
                  </div>
                  
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Assessment</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Score</TableHead>
                        <TableHead className="w-[150px]"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scores.map((score) => (
                        <TableRow key={score.id}>
                          <TableCell className="font-medium">{score.assessmentTitle}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="capitalize text-[10px]">
                              {score.assessmentType?.replace('_', ' ')}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(score.createdAt), "MMM d, yyyy")}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm">
                            {score.score} / {score.maxScore}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Progress value={score.percentage || 0} className="h-2" />
                              <span className="text-xs text-muted-foreground w-8 text-right">{Math.round(score.percentage || 0)}%</span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground space-y-3 py-12 border border-dashed rounded-lg">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/50" />
                  <p>No assessment records found.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
