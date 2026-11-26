import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReaderPreferenceEntity } from './entity/reader-preference.entity';
import { TopicPreferenceEntity } from './entity/topic-preference.entity';
import { UserEntity } from './entity/user.entity';
import { PreferenceRepositoryService } from './preference-repository.service';
import { UserRepositoryService } from './user-repository.service';

/** Account-owned persistence; not exported outside AccountModule. */
@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, ReaderPreferenceEntity, TopicPreferenceEntity])],
  providers: [UserRepositoryService, PreferenceRepositoryService],
  exports: [UserRepositoryService, PreferenceRepositoryService],
})
export class AccountRepositoryModule {}
