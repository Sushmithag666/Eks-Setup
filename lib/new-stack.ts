import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as eks from 'aws-cdk-lib/aws-eks'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as rds from 'aws-cdk-lib/aws-rds'
import * as route53targets from 'aws-cdk-lib/aws-route53-targets'
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class NewStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
  
    // Create VPC
  const vpc = new ec2.Vpc(this, 'MyVPC', {
    subnetConfiguration: [
      {
        cidrMask: 24,
        name: 'Public',
        subnetType: ec2.SubnetType.PUBLIC,
      },
      {
        cidrMask: 24,
        name: 'Private1',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      {
        cidrMask: 24,
        name: 'Private2',
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    ],
  });

  // Create Cluster with no default capacity (node group will be added later)
  const eksCluster = new eks.Cluster(this, "EKSCluster", {
    vpc: vpc,
    defaultCapacity: 0,
    version: eks.KubernetesVersion.V1_27,
    ipFamily: eks.IpFamily.IP_V4,
    clusterLogging: [
      eks.ClusterLoggingTypes.AUDIT
    ],
    outputClusterName: true,
    outputConfigCommand: true,
  });

  eksCluster.addNodegroupCapacity("custom-node-group", {
    amiType: eks.NodegroupAmiType.AL2_X86_64,
    instanceTypes: [new ec2.InstanceType("m5.large")],
    desiredSize: 2,
    diskSize: 20,
    nodeRole: new iam.Role(this, "eksClusterNodeGroupRole", {
      roleName: "eksClusterNodeGroupRole",
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKSWorkerNodePolicy"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEC2ContainerRegistryReadOnly"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonEKS_CNI_Policy"),
      ],
    }),
  });

  // Fargate
  const myProfile = new eks.FargateProfile(this, 'myProfile', {
    cluster: eksCluster,
    selectors: [ { namespace: 'default' } ],
  });

  // Managed Addon: kube-proxy
  const kubeProxy = new eks.CfnAddon(this, "addonKubeProxy", {
    addonName: "kube-proxy",
    clusterName: eksCluster.clusterName,
  });

  // Managed Addon: coredns
  const coreDns = new eks.CfnAddon(this, "addonCoreDns", {
    addonName: "coredns",
    clusterName: eksCluster.clusterName,
  });

  // Managed Addon: vpc-cni
  const vpcCni = new eks.CfnAddon(this, "addonVpcCni", {
    addonName: "vpc-cni",
    clusterName: eksCluster.clusterName,
  });

  

  // Integrate CloudFront with S3
  const bucket = new s3.Bucket(this, 'MyBucket');
  const distribution = new cloudfront.CloudFrontWebDistribution(this, 'MyDistribution', {
    originConfigs: [
      {
        s3OriginSource: {
          s3BucketSource: bucket,
        },
        behaviors: [{ isDefaultBehavior: true }],
      },
    ],
  });

  // 👇 create RDS instance
  const dbInstance = new rds.DatabaseInstance(this, 'db-instance', {
    vpc,
    vpcSubnets: {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    },
    engine: rds.DatabaseInstanceEngine.postgres({
      version: rds.PostgresEngineVersion.VER_14,
    }),
    instanceType: ec2.InstanceType.of(
      ec2.InstanceClass.BURSTABLE3,
      ec2.InstanceSize.MICRO,
    ),
    credentials: rds.Credentials.fromGeneratedSecret('postgres'),
    multiAz: false,
    allocatedStorage: 100,
    maxAllocatedStorage: 120,
    allowMajorVersionUpgrade: false,
    autoMinorVersionUpgrade: true,
    backupRetention: cdk.Duration.days(0),
    deleteAutomatedBackups: true,
    removalPolicy: cdk.RemovalPolicy.DESTROY,
    deletionProtection: false,
    databaseName: 'test',
    publiclyAccessible: false,
  });

  new cdk.CfnOutput(this, 'dbEndpoint', {
    value: dbInstance.instanceEndpoint.hostname,
  });

  new cdk.CfnOutput(this, 'secretName', {
    value: dbInstance.secret?.secretName!,
  });

  }
}
