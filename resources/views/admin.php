<!--
*
* INSPINIA - Responsive Admin Theme
* Version 2.6
*
-->

<!DOCTYPE html>
<html ng-app="inspinia">

<head>
    <script>
    var appPath = '<?php echo $public;?>';

    </script>

    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">

    <!-- Page title set in pageTitle directive -->
    <title page-title></title>

    <!-- Bootstrap -->
    <link href="<?php echo $public;?>css/bootstrap.min.css" rel="stylesheet">

    <!-- Font awesome -->
    <link href="<?php echo $public;?>font-awesome/css/font-awesome.css" rel="stylesheet">

    <!-- Main Inspinia CSS files -->
    <link href="<?php echo $public;?>css/animate.css" rel="stylesheet">
    <link id="loadBefore" href="<?php echo $public;?>css/style.css" rel="stylesheet">


</head>

<!-- ControllerAs syntax -->
<!-- Main controller with serveral data used in Inspinia theme on diferent view -->
<body ng-controller="MainCtrl as main" class="{{$state.current.data.specialClass}}" landing-scrollspy id="page-top">

<!-- Main view  -->
<div ui-view></div>
<!-- jQuery and Bootstrap -->

<script src="<?php echo $public;?>js/jquery/jquery-2.1.1.min.js"></script>
<script src="<?php echo $public;?>js/plugins/jquery-ui/jquery-ui.js"></script>
<script src="<?php echo $public;?>js/bootstrap/bootstrap.min.js"></script>

<!-- MetsiMenu -->
<script src="<?php echo $public;?>js/plugins/metisMenu/jquery.metisMenu.js"></script>

<!-- SlimScroll -->
<script src="<?php echo $public;?>js/plugins/slimscroll/jquery.slimscroll.min.js"></script>

<!-- Peace JS -->
<script src="<?php echo $public;?>js/plugins/pace/pace.min.js"></script>

<!-- Custom and plugin javascript -->
<script src="<?php echo $public;?>js/inspinia.js"></script>

<!-- Main Angular scripts-->
<script src="<?php echo $public;?>js/angular/angular.min.js"></script>
<script src="<?php echo $public;?>js/angular/angular-sanitize.js"></script>
<script src="<?php echo $public;?>js/plugins/oclazyload/dist/ocLazyLoad.js"></script>
<script src="<?php echo $public;?>js/angular-translate/angular-translate.min.js"></script>
<script src="<?php echo $public;?>js/ui-router/angular-ui-router.min.js"></script>
<script src="<?php echo $public;?>js/bootstrap/ui-bootstrap-tpls-1.1.2.min.js"></script>
<script src="<?php echo $public;?>js/plugins/angular-idle/angular-idle.js"></script>

<!--
 You need to include this script on any page that has a Google Map.
 When using Google Maps on your own site you MUST signup for your own API key at:
 https://developers.google.com/maps/documentation/javascript/tutorial#api_key
 After your sign up replace the key in the URL below..
-->
<script type="text/javascript" src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDQTpXj82d8UpCi97wzo_nKXL7nYrd4G70"></script>

<!-- Anglar App Script -->
<script src="<?php echo $public;?>js/app.js"></script>
<script>
<?php include 'config.php'; ?>
</script>
<script src="<?php echo $public;?>js/translations.js"></script>
<script src="<?php echo $public;?>js/directives.js"></script>
<script src="<?php echo $public;?>js/controllers.js"></script>

</body>
</html>
