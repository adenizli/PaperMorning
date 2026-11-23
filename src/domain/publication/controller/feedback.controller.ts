import { BadRequestException, Body, Controller, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../../../common/http/authenticated-user';
import type { FeedbackModel, FeedbackValue } from '../model/feedback.model';
import { IssueService } from '../service/issue.service';

export class FeedbackInput {
  @IsIn([1, -1])
  value!: FeedbackValue;
}

const CONTENT_KEY = /^[a-z0-9-]{1,64}$/;

@Controller('issues/:id/feedback')
export class FeedbackController {
  constructor(private readonly issues: IssueService) {}

  /** 👍 = 1, 👎 = -1. One active vote per content key; repeating replaces the previous vote. */
  @Put(':contentKey')
  vote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('contentKey') contentKey: string,
    @Body() input: FeedbackInput,
  ): Promise<FeedbackModel> {
    if (!CONTENT_KEY.test(contentKey)) throw new BadRequestException('Invalid content key');
    return this.issues.setFeedback(user.id, id, contentKey, input.value);
  }
}
