import { Kysely, MysqlDialect, type Selectable } from 'kysely';
import mysql from 'mysql2';
import type { AppEnv } from '@/config/env.js';

export type ResumeRow = {
  id: string;
  title: string;
  user_id: string;
  is_published: number | boolean | null;
  publish_date: Date | null;
  preview_image: string | null;
  view_count: number | null;
  usage_count: number | null;
  collect_count: number | null;
  create_time: Date | null;
  update_time: Date | null;
  delete_flag: string | null;
  style_config: string | null;
  publish_id: string | null;
  template: string | null;
};

export type ResumeModuleRow = {
  id: string;
  resume_id: string | null;
  module_type: string;
  display_order: number;
  module_content: string | null;
  create_time: Date | null;
  update_time: Date | null;
  delete_flag: string | null;
  user_id: string | null;
  has_enable: number | boolean | null;
};

export type UserActionRow = {
  id: string;
  resume_id: string;
  user_id: string;
  action_type: string;
  delete_flag: string | null;
};

export type ResumeTagRow = {
  id: string;
  resume_id: string;
  tag_name: string;
};

export type TagRow = {
  id: string;
  name: string;
  is_category: number | boolean | null;
  create_time: Date | null;
  update_time: Date | null;
  delete_flag: string | null;
};

export type ClientUserRow = {
  ID: string;
  AVATAR: string | null;
  SIGNATURE: string | null;
  ACCOUNT: string | null;
  PHONE: string | null;
  EMAIL: string | null;
  NICKNAME: string | null;
  NAME: string | null;
  member_level: string | null;
  member_expiration_time: Date | null;
  offer_member_expiration_time: Date | null;
  photo_member_expiration_time: Date | null;
  union_id: string | null;
  wechat_openid: string | null;
  create_time: Date | null;
  EXT_JSON: string | null;
  invitation_code: string | null;
  invitation_rebate_rate: number | string | null;
  has_distribution_promo_code: number | boolean | null;
  withdrawn_rebate_amount: number | string | null;
  user_status: string | null;
  DELETE_FLAG: string | null;
};

export type UserFunctionLimitRow = {
  id: string;
  function_name: string;
  remaining_uses: number | null;
  user_id: string;
  create_time: Date | null;
  update_time: Date | null;
};

export type ChatDialogueRow = {
  id: string;
  user_id: string | null;
  dialogue_name: string | null;
  robot_model_id: string | null;
  remark: string | null;
  DELETE_FLAG: string | null;
  CREATE_TIME: Date | null;
  CREATE_USER: string | null;
  UPDATE_TIME: Date | null;
  UPDATE_USER: string | null;
  ip: string | null;
  request_uuid: string | null;
  login_status: number | boolean | null;
  visibility_type: number | null;
  chat_group_id: string | null;
  END_TIME: Date | null;
};

export type ChatMessageRow = {
  chat_message_id: string;
  content: string | null;
  user_id: string | null;
  remark: string | null;
  DELETE_FLAG: string | null;
  CREATE_TIME: Date | null;
  chat_dialogue_id: string | null;
  send_time: Date | null;
  robot_model_id: string | null;
  include_sensitive_word: string | null;
  ip: string | null;
  has_ai: number | boolean;
  relevance_id: string | number | null;
  has_ignore_context: number | boolean | null;
  chat_model: string | null;
  image_list: string | null;
  chat_group_id: string | null;
  has_read: number | boolean | null;
  tokens: number | null;
  consume_magic: number | string | null;
  context_tokens: number | null;
};

export type MemberPackageRow = {
  id: string;
  delete_flag: string | null;
  create_time: Date | null;
  update_time: Date | null;
  package_name: string;
  current_amount: string | number;
  original_amount: string | number;
  sort: number | null;
  ext_json: string | null;
  gift_day: number | null;
  tags: string | null;
  billing_mode: string | null;
  usage_count: number | null;
  stripe_product_id: string | null;
};

export type RedeemCodeRow = {
  code_id: string;
  code: string;
  code_type: string | null;
  expiration_time: Date | null;
  max_redemption: number | null;
  current_redemption: number | null;
  delete_flag: string | null;
  create_time: Date | null;
  update_time: Date | null;
  ext_json: string | null;
  user_id: string | null;
  rebate_rate: string | number | null;
  member_package_id: string | null;
};

export type ResumeReportRow = {
  id: string;
  create_time: Date | null;
  update_time: Date | null;
  user_id: string;
  delete_flag: string | null;
  resume_info: string | null;
  job_info: string | null;
  prompt: string | null;
  report_info: string | null;
};

export type InterviewQuestionRow = {
  id: string;
  user_id: string;
  create_time: Date | null;
  update_time: Date | null;
  delete_flag: string | null;
  question: string | null;
  job_info: string | null;
  resume_info: string | null;
};

export type CampusRecruitmentRow = {
  id: string;
  create_time: Date | null;
  update_time: Date | null;
  record_time: Date | null;
  expiration_time: Date | null;
  company: string | null;
  referral_code: string | null;
  referral_method: string | null;
  title: string | null;
  progress_check: string | null;
  work_location: string | null;
  industry: string | null;
  positions: string | null;
  remarks: string | null;
  main_business: string | null;
  info_type: string | null;
};

export type CampusRecruitmentUserRow = CampusRecruitmentRow & {
  user_id: string;
  recruitment_id: string | null;
  recruitment_status: string | null;
  recruitment_remarks: string | null;
};

export type DevDictRow = {
  ID: string;
  PARENT_ID: string | null;
  DICT_LABEL: string | null;
  DICT_VALUE: string | null;
  CATEGORY: string | null;
  SORT_CODE: number | null;
  EXT_JSON: string | null;
  DELETE_FLAG: string | null;
  CREATE_TIME: Date | null;
  UPDATE_TIME: Date | null;
};

export type InvitationRecordRow = {
  id: string;
  delete_flag: string | null;
  create_time: Date | null;
  user_id: string;
  target_user_id: string | null;
  invitation_code: string | null;
  ip: string | null;
  recharged_amount: number | string | null;
  category: string | null;
  rebate_amount: number | string | null;
  rebate_rate: number | string | null;
};

export type FrontRelationRow = {
  id: string;
  object_id: string | null;
  target_id: string | null;
  category: string | null;
  user_id: string | null;
  create_time: Date | null;
};

export type RechargeRecordRow = {
  id: string;
  delete_flag: string | null;
  user_id: string | null;
  amount: number | string | null;
};

export type AdSlotRow = {
  id: string;
  delete_flag: string | null;
  create_time: Date | null;
  create_user: string | null;
  update_time: Date | null;
  update_user: string | null;
  project_code: string | null;
  slot_code: string | null;
  slot_name: string | null;
  ad_mode: string | null;
  title: string | null;
  image_url: string | null;
  target_url: string | null;
  status: string | null;
  sort_code: number | null;
  click_count: number | null;
  last_click_time: Date | null;
  start_time: Date | null;
  end_time: Date | null;
  remark: string | null;
  ext_json: string | null;
};

export type NotificationRow = {
  id: string;
  type: string | null;
  title: string | null;
  content: string | null;
  create_time: Date | null;
  update_time: Date | null;
  create_user_id: string | null;
  delete_flag: string | null;
  images: string | null;
  user_group: string | null;
  expired_time: Date | null;
  send_user_id: string | null;
  cases_id: string | null;
  weight: number | null;
};

export type UserNotificationRow = {
  id: string;
  user_id: string;
  notification_id: string;
  read_flag: number | boolean | null;
  delete_flag: string | null;
  create_time: Date | null;
  read_time: Date | null;
  type: string | null;
};

export type SysUserRow = {
  ID: string;
  AVATAR: string | null;
  SIGNATURE: string | null;
  ACCOUNT: string | null;
  PASSWORD: string | null;
  NAME: string | null;
  NICKNAME: string | null;
  PHONE: string | null;
  EMAIL: string | null;
  GENDER: string | null;
  DELETE_FLAG: string | null;
  CREATE_TIME: Date | null;
  UPDATE_TIME: Date | null;
};

export type PaymentOrderRow = {
  id: string;
  delete_flag: string | null;
  create_time: Date | null;
  update_time: Date | null;
  pay_channel: string | null;
  amount: number | string | null;
  recharge_record_id: string | null;
  order_no: string;
  status: string | null;
  openid: string | null;
  product_id: string | null;
  remark: string | null;
  ip: string | null;
  code_url: string | null;
  user_id: string | null;
  ext_json: string | null;
  redeem_code_id: string | null;
};

export type AiPhotoTemplateRow = {
  id: string;
  template_code: string;
  template_name: string;
  gender: string | null;
  sample_image_url: string | null;
  prompt: string | null;
  status: string | null;
  sort_code: number | null;
  remark: string | null;
  ext_json: string | null;
  create_time: Date | null;
  update_time: Date | null;
  delete_flag: string | null;
};

export type AiPhotoGenerationRow = {
  id: string;
  delete_flag: string | null;
  create_time: Date | null;
  update_time: Date | null;
  user_id: string;
  source_image_url: string | null;
  result_image_url: string | null;
  size_id: string | null;
  size_name: string | null;
  width: number | null;
  height: number | null;
  background_color: string | null;
  background_hex: string | null;
  template_id: string | null;
  template_name: string | null;
  gender: string | null;
  status: string | null;
  error_message: string | null;
  provider: string | null;
  model_id: string | null;
  provider_request_id: string | null;
  duration_ms: number | null;
  estimated_cost: number | string | null;
  billing_mode: string | null;
  cost_count: number | null;
  member_snapshot: string | null;
  ext_json: string | null;
};

export type Database = {
  sc_resume: ResumeRow;
  sc_resume_modules: ResumeModuleRow;
  sc_user_actions: UserActionRow;
  sc_resume_tags: ResumeTagRow;
  sc_tags: TagRow;
  client_user: ClientUserRow;
  sc_user_function_limits: UserFunctionLimitRow;
  t_chat_dialogue: ChatDialogueRow;
  t_chat_message: ChatMessageRow;
  sc_member_package: MemberPackageRow;
  t_redeem_code: RedeemCodeRow;
  t_invitation_records: InvitationRecordRow;
  t_front_relation: FrontRelationRow;
  t_recharge_record: RechargeRecordRow;
  sc_ad_slot_config: AdSlotRow;
  sc_notification: NotificationRow;
  sc_user_notification: UserNotificationRow;
  sc_resume_report: ResumeReportRow;
  sc_interview_questions: InterviewQuestionRow;
  sc_campus_recruitment: CampusRecruitmentRow;
  sc_campus_recruitment_user: CampusRecruitmentUserRow;
  dev_dict: DevDictRow;
  sys_user: SysUserRow;
  t_payment_order: PaymentOrderRow;
  sc_ai_photo_template_config: AiPhotoTemplateRow;
  sc_ai_photo_generation_record: AiPhotoGenerationRow;
};

export function createDatabase(env: AppEnv): Kysely<Database> {
  const pool = mysql.createPool({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
    waitForConnections: true,
    enableKeepAlive: true,
    decimalNumbers: true,
    timezone: 'Z',
  });

  return new Kysely<Database>({
    dialect: new MysqlDialect({ pool }),
  });
}

export type Resume = Selectable<ResumeRow>;
