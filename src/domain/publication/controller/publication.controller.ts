import { Controller, Get, Header, Param, ParseUUIDPipe, StreamableFile } from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../../../common/http/authenticated-user';
import type { FeedbackValue } from '../model/feedback.model';
import type { IssueContentModel } from '../model/issue-content.model';
import type { IssueSummary } from '../model/issue.model';
import { IssueService } from '../service/issue.service';

interface IssueResponse {
  id: string;
  issueDate: string;
  status: string;
  publishedAt: Date | null;
  content: IssueContentModel;
  feedback: Record<string, FeedbackValue>;
}

/** Reader's own archive. Identity comes only from the auth guard; others' issues are 404. */
@Controller('issues')
export class PublicationController {
  constructor(private readonly issues: IssueService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<IssueSummary[]> {
    return this.issues.listForUser(user.id);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<IssueResponse> {
    const { issue, feedback } = await this.issues.getForUser(user.id, id);
    return {
      id: issue.id,
      issueDate: issue.issueDate,
      status: issue.status,
      publishedAt: issue.publishedAt,
      content: issue.content,
      feedback,
    };
  }

  @Get(':id/pdf')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pdf(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { bytes, filename } = await this.issues.getPdfForUser(user.id, id);
    return new StreamableFile(bytes, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
      length: bytes.length,
    });
  }
}
