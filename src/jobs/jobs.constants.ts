/** Имена очередей и задач BullMQ — в одном месте, чтобы продюсер и консьюмер не разошлись. */
export const STORIES_QUEUE = 'stories';

export const JOB_DELETE_EXPIRED_STORY = 'delete-expired-story';

export interface DeleteExpiredStoryPayload {
  storyId: number;
}
