import { Module } from "@nestjs/common";
import { CacheModule } from "./cache.module";

@Module({
  imports: [CacheModule]
})
export class AppModule {}
