/** Public user identity. Never carries a password or hash. */
export interface UserModel {
  id: string;
  username: string;
  email: string;
  createdAt: Date;
}
